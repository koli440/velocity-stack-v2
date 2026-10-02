import sys
import os
import json
import math
import tempfile
import numpy as np
from fitparse import FitFile
from http.server import BaseHTTPRequestHandler

def compute_durational_curve(data_series, intervals):
    """Computes the maximum averages for the given time intervals (rolling max)."""
    if not data_series or len(data_series) == 0:
        return {}
    
    arr = np.array(data_series, dtype=float)
    n = len(arr)
    curve = {}
    
    for sec in intervals:
        if n < sec:
            continue
        # Rolling sum via convolution
        window = np.ones(sec)
        rolling_sums = np.convolve(arr, window, mode='valid')
        max_avg = float(np.max(rolling_sums) / sec)
        
        # Key: 1s, 5s, 1m, 1h...
        if sec < 60:
            label = f"{sec}s"
        elif sec < 3600:
            label = f"{sec // 60}m"
        else:
            label = f"{sec // 3600}h"
            
        curve[label] = round(max_avg, 1)
        
    return curve

def compute_normalized_power(watts_stream, window_sec=30):
    """Standard Normalized Power algorithm: 30s rolling average -> ^4 -> average -> ^0.25."""
    if not watts_stream or len(watts_stream) < window_sec:
        return None

    arr = np.array(watts_stream, dtype=float)
    window = np.ones(window_sec) / window_sec
    rolling_avg = np.convolve(arr, window, mode='valid')
    quad_mean = np.mean(np.power(rolling_avg, 4))
    return round(float(quad_mean ** 0.25))

def compute_elevation_changes(altitude_stream, smoothing_window=5):
    """Sum of positive/negative elevation changes from the (smoothed) altitude stream."""
    if not altitude_stream or len(altitude_stream) < 2:
        return 0.0, 0.0

    arr = np.array(altitude_stream, dtype=float)
    if len(arr) >= smoothing_window:
        kernel = np.ones(smoothing_window) / smoothing_window
        arr = np.convolve(arr, kernel, mode='valid')

    diffs = np.diff(arr)
    gain = float(np.sum(diffs[diffs > 0]))
    loss = float(np.sum(np.abs(diffs[diffs < 0])))
    return round(gain, 1), round(loss, 1)

def safe_mean(values):
    valid = [v for v in values if v is not None]
    return round(float(np.mean(valid)), 1) if valid else None

# Standard track (fixed-gear) wheel diameter in inches - the same constant as
# `calcGearInches()` in src/app/activities/[id]/page.js, so both calculations stay consistent.
TRACK_WHEEL_DIAMETER_INCHES = 26.8

def gear_development_m(chainring, cog, wheel_diameter_inches=TRACK_WHEEL_DIAMETER_INCHES):
    """Distance (in meters) the wheel travels per crank revolution on a fixed-gear track bike."""
    gear_inches = (float(chainring) / float(cog)) * wheel_diameter_inches
    return gear_inches * math.pi * 0.0254  # inches -> meters

EARTH_RADIUS_M = 6371000

def haversine_m(lat1, lon1, lat2, lon2):
    """Great-circle distance (in meters) between two GPS coordinates (in degrees)."""
    lat1, lon1, lat2, lon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    d_lat = lat2 - lat1
    d_lon = lon2 - lon1
    a = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lon / 2) ** 2
    return EARTH_RADIUS_M * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def derive_speed_and_distance_from_gps(gps_points):
    """gps_points: list of (lat_deg, lng_deg, timestamp) tuples, already in record order.
    Returns (speed_kmh_stream, distance_m) aligned 1:1 with gps_points; first sample is always 0
    (no prior fix to compare against)."""
    speed_kmh = [0.0] * len(gps_points)
    distance_m = 0.0
    for i in range(1, len(gps_points)):
        lat1, lng1, ts1 = gps_points[i - 1]
        lat2, lng2, ts2 = gps_points[i]
        dt_s = (ts2 - ts1).total_seconds() if ts1 and ts2 else 1.0
        step_m = haversine_m(lat1, lng1, lat2, lng2)
        distance_m += step_m
        speed_kmh[i] = round((step_m / dt_s) * 3.6, 1) if dt_s > 0 else 0.0
    return speed_kmh, round(distance_m, 1)

def analyze_fit_file(file_path, chainring=None, cog=None, is_fixed_gear=False):
    fitfile = FitFile(file_path)
    
    watts_stream = []
    cadence_stream = []
    speed_stream = []
    hr_stream = []
    lat_stream = []
    lng_stream = []
    gps_points = []  # (lat, lng, timestamp) tuples, aligned with lat_stream/lng_stream (sparse)
    altitude_stream = []
    timestamp_stream = []
    distance_stream = []

    # FIT stores GPS coordinates in semicircles -> degrees: deg = semicircles * (180 / 2^31)
    SEMICIRCLE_TO_DEG = 180.0 / (2 ** 31)

    for record in fitfile.get_messages('record'):
        vals = record.get_values()
        
        # Power
        w = vals.get('power', 0) or 0
        watts_stream.append(int(w))
        
        # Cadence
        c = vals.get('cadence', 0) or 0
        cadence_stream.append(int(c))
        
        # Speed: FIT stores it in m/s -> convert to km/h. Newer/faster devices send
        # "enhanced_speed" instead of (or in addition to) the classic "speed" field - if we
        # ignored it, speed would appear missing even though it's present in the file.
        s = vals.get('enhanced_speed')
        if s is None:
            s = vals.get('speed', 0.0)
        s = s or 0.0
        speed_stream.append(round(float(s) * 3.6, 1))
        
        # Heart rate
        hr = vals.get('heart_rate')
        if hr is not None:
            hr_stream.append(int(hr))

        # Record timestamp (for start_time / elapsed_time and the GPS dt below)
        ts = vals.get('timestamp')
        if ts is not None:
            timestamp_stream.append(ts)

        # GPS position (if the ride includes satellite data, e.g. a road ride)
        lat_raw = vals.get('position_lat')
        lng_raw = vals.get('position_long')
        if lat_raw is not None and lng_raw is not None:
            lat_deg = round(lat_raw * SEMICIRCLE_TO_DEG, 6)
            lng_deg = round(lng_raw * SEMICIRCLE_TO_DEG, 6)
            lat_stream.append(lat_deg)
            lng_stream.append(lng_deg)
            gps_points.append((lat_deg, lng_deg, ts))

        # Altitude
        alt = vals.get('altitude') or vals.get('enhanced_altitude')
        if alt is not None:
            altitude_stream.append(round(float(alt), 1))

        # Cumulative distance (meters) - if the device sends this field
        dist = vals.get('distance')
        if dist is not None:
            distance_stream.append(float(dist))
            
    # Compute torque (in Nm) from W and RPM: T = (P * 60) / (2 * pi * RPM)
    torque_stream = []
    for w, c in zip(watts_stream, cadence_stream):
        if c > 0 and w > 0:
            t = (w * 60.0) / (2.0 * math.pi * c)
            torque_stream.append(round(t, 1))
        else:
            torque_stream.append(0.0)

    # Speed/distance aren't always directly available - depending on what the device can
    # record, we pick in this order (see issue #12 discussion about fixed-gear track bikes vs.
    # freewheel road rides):
    #   1) "sensor"             - the file contains a real (nonzero) speed signal
    #   2) "gps"                - no speed sensor, but a GPS track is available -> speed
    #                             and distance are derived from position (works for freewheel/road bikes too)
    #   3) "derived_from_cadence" - no sensor or GPS, but it's a fixed-gear (track) bike
    #                             with cadence and a known gear -> speed = f(cadence, gear)
    #   4) "unavailable"        - none of the above is available; it's more honest to admit that
    #                             than to silently show zero/incorrect data
    gps_distance_m = None
    has_speed_signal = any(v > 0 for v in speed_stream)
    if has_speed_signal:
        speed_source = 'sensor'
    elif len(gps_points) > 1:
        gps_speed_kmh, gps_distance_m = derive_speed_and_distance_from_gps(gps_points)
        # GPS points are sparse (only recorded when there's a fix) - we map them back onto a
        # full, per-second speed_stream using the index of the nearest earlier GPS point, so
        # the chart/summaries stay aligned with the rest of the streams.
        speed_stream = [0.0] * len(watts_stream)
        gps_idx = 0
        for i in range(len(speed_stream)):
            if gps_idx < len(gps_points) - 1 and timestamp_stream and i < len(timestamp_stream):
                while (
                    gps_idx < len(gps_points) - 1
                    and gps_points[gps_idx + 1][2] is not None
                    and timestamp_stream[i] >= gps_points[gps_idx + 1][2]
                ):
                    gps_idx += 1
            speed_stream[i] = gps_speed_kmh[min(gps_idx, len(gps_speed_kmh) - 1)]
        speed_source = 'gps'
    elif is_fixed_gear and chainring and cog and cadence_stream:
        development_m = gear_development_m(chainring, cog)
        speed_stream = [
            round(development_m * (c / 60.0) * 3.6, 1) if c > 0 else 0.0
            for c in cadence_stream
        ]
        speed_source = 'derived_from_cadence'
    else:
        speed_source = 'unavailable'

    intervals = [1, 5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1200, 1800, 3600]
    
    curves = {
        'Power': compute_durational_curve(watts_stream, intervals),
        'Cadence': compute_durational_curve(cadence_stream, intervals),
        'Speed': compute_durational_curve(speed_stream, intervals),
        'Torque': compute_durational_curve(torque_stream, intervals)
    }
    if hr_stream:
        curves['HeartRate'] = compute_durational_curve(hr_stream, intervals)
        
    has_gps = len(lat_stream) > 1

    # Time: elapsed = from the first to the last record; moving = only seconds with speed > 1 km/h
    # (FIT records are typically sampled at ~1Hz, so 1 sample ~= 1 second)
    if len(timestamp_stream) >= 2:
        start_time = timestamp_stream[0]
        elapsed_time_s = (timestamp_stream[-1] - timestamp_stream[0]).total_seconds()
    else:
        start_time = timestamp_stream[0] if timestamp_stream else None
        elapsed_time_s = float(max(len(watts_stream) - 1, 0))

    MOVING_SPEED_THRESHOLD_KMH = 1.0
    # If we have no way to determine/derive speed, it's more honest to return None than
    # to silently pretend 0 seconds moving.
    moving_time_s = (
        float(sum(1 for s in speed_stream if s > MOVING_SPEED_THRESHOLD_KMH))
        if speed_source != 'unavailable'
        else None
    )

    # Distance: we prefer the cumulative field from the FIT file (most accurate, independent of how
    # we derived speed), then the GPS track (if we used it to derive speed above),
    # otherwise we integrate the (derived or real) speed. Without any of these we leave it as None.
    if distance_stream:
        distance_m = round(distance_stream[-1] - distance_stream[0], 1)
    elif speed_source == 'gps' and gps_distance_m is not None:
        distance_m = gps_distance_m
    elif speed_source != 'unavailable' and speed_stream:
        distance_m = round(sum(s / 3.6 for s in speed_stream), 1)
    else:
        distance_m = None

    elevation_gain_m, elevation_loss_m = compute_elevation_changes(altitude_stream)

    summary = {
        'max_power_w': int(max(watts_stream)) if watts_stream else None,
        'max_cadence_rpm': int(max(cadence_stream)) if cadence_stream else None,
        'max_speed_kmh': float(max(speed_stream)) if speed_stream and speed_source != 'unavailable' else None,
        'peak_torque_nm': float(max(torque_stream)) if torque_stream else None,
        'has_gps': has_gps,
        'start_time': start_time.isoformat() if start_time else None,
        'elapsed_time_s': elapsed_time_s,
        'moving_time_s': moving_time_s,
        'distance_m': distance_m,
        'avg_speed_kmh': safe_mean(speed_stream) if speed_source != 'unavailable' else None,
        'avg_power_w': round(safe_mean(watts_stream)) if watts_stream else None,
        'avg_cadence_rpm': round(safe_mean(cadence_stream)) if cadence_stream else None,
        'avg_torque_nm': safe_mean(torque_stream),
        'avg_hr': round(safe_mean(hr_stream)) if hr_stream else None,
        'max_hr': int(max(hr_stream)) if hr_stream else None,
        'normalized_power_w': compute_normalized_power(watts_stream),
        'elevation_gain_m': elevation_gain_m,
        'elevation_loss_m': elevation_loss_m,
        'speed_source': speed_source,
    }
    
    output = {
        'success': True,
        'summary': summary,
        'curves': curves,
        'time_series': {
            'watts': watts_stream,
            'cadence': cadence_stream,
            'torque': torque_stream,
            'speed': speed_stream,
            'heartrate': hr_stream,
            'latitude': lat_stream,
            'longitude': lng_stream,
            'altitude': altitude_stream,
        }
    }
    
    return output

def _parse_multipart(body, boundary):
    """Minimal parser for multipart/form-data without depending on the cgi module
    (removed in newer Python versions). Returns dict name -> (filename, content_bytes)."""
    fields = {}
    delimiter = b'--' + boundary
    for raw_part in body.split(delimiter):
        part = raw_part.strip(b'\r\n')
        if not part or part == b'--':
            continue
        if b'\r\n\r\n' not in part:
            continue
        headers_raw, content = part.split(b'\r\n\r\n', 1)
        content = content[:-2] if content.endswith(b'\r\n') else content

        name = None
        filename = None
        for line in headers_raw.decode('utf-8', errors='replace').split('\r\n'):
            if line.lower().startswith('content-disposition'):
                for segment in line.split(';'):
                    segment = segment.strip()
                    if segment.startswith('name='):
                        name = segment.split('=', 1)[1].strip('"')
                    elif segment.startswith('filename='):
                        filename = segment.split('=', 1)[1].strip('"')

        if name:
            fields[name] = (filename, content)

    return fields

class handler(BaseHTTPRequestHandler):
    """Vercel Python Function entrypoint: the class must be named exactly `handler`
    and inherit from BaseHTTPRequestHandler, otherwise Vercel won't recognize the file as a function."""

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        tmp_path = None
        try:
            content_type = self.headers.get('Content-Type', '')
            content_length = int(self.headers.get('Content-Length', 0) or 0)
            body = self.rfile.read(content_length)

            if 'multipart/form-data' not in content_type or 'boundary=' not in content_type:
                self._send_json({'error': 'Expected multipart/form-data upload with a .fit file'}, 400)
                return

            boundary = content_type.split('boundary=')[1].split(';')[0].strip().encode()
            fields = _parse_multipart(body, boundary)

            file_field = fields.get('file')
            if not file_field:
                self._send_json({'error': 'Missing "file" field in upload'}, 400)
                return

            _, file_bytes = file_field

            # Optional gear (chainring/cog) sent by the uploader - used to derive
            # speed from cadence if the .fit file doesn't contain a real speed sensor
            # (typical for track bikes without GPS/speed sensor).
            def _read_field_number(field_name):
                field = fields.get(field_name)
                if not field:
                    return None
                _, raw = field
                try:
                    return float(raw.decode('utf-8').strip())
                except (ValueError, UnicodeDecodeError):
                    return None

            chainring = _read_field_number('chainring')
            cog = _read_field_number('cog')

            # Is this ride on a fixed-gear (track) bike without a freewheel? If so and the file
            # contains neither a speed sensor nor GPS, we can safely derive speed from cadence -
            # on a freewheel bike (road ride) this would be misleading (the rider could coast
            # or freewheel downhill without pedaling).
            is_fixed_gear_field = fields.get('is_fixed_gear')
            is_fixed_gear = False
            if is_fixed_gear_field:
                _, raw = is_fixed_gear_field
                is_fixed_gear = raw.decode('utf-8', errors='replace').strip().lower() in ('true', '1')

            with tempfile.NamedTemporaryFile(suffix='.fit', delete=False) as tmp:
                tmp.write(file_bytes)
                tmp_path = tmp.name

            result = analyze_fit_file(tmp_path, chainring=chainring, cog=cog, is_fixed_gear=is_fixed_gear)
            self._send_json(result, 200)
        except Exception as e:
            self._send_json({'success': False, 'error': str(e)}, 500)
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)

if __name__ == '__main__':
    if len(sys.argv) > 1:
        res = analyze_fit_file(sys.argv[1])
        print(json.dumps(res))