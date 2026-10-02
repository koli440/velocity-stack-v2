import sys
import os
import json
import math
import tempfile
import numpy as np
from fitparse import FitFile
from http.server import BaseHTTPRequestHandler

def compute_durational_curve(data_series, intervals):
    """Vypočítá maximální průměry pro zadané časové intervaly (rolling max)."""
    if not data_series or len(data_series) == 0:
        return {}
    
    arr = np.array(data_series, dtype=float)
    n = len(arr)
    curve = {}
    
    for sec in intervals:
        if n < sec:
            continue
        # Klouzavý součet přes konvoluci
        window = np.ones(sec)
        rolling_sums = np.convolve(arr, window, mode='valid')
        max_avg = float(np.max(rolling_sums) / sec)
        
        # Klíč: 1s, 5s, 1m, 1h...
        if sec < 60:
            label = f"{sec}s"
        elif sec < 3600:
            label = f"{sec // 60}m"
        else:
            label = f"{sec // 3600}h"
            
        curve[label] = round(max_avg, 1)
        
    return curve

def compute_normalized_power(watts_stream, window_sec=30):
    """Standardní algoritmus Normalized Power: 30s klouzavý průměr -> ^4 -> průměr -> ^0.25."""
    if not watts_stream or len(watts_stream) < window_sec:
        return None

    arr = np.array(watts_stream, dtype=float)
    window = np.ones(window_sec) / window_sec
    rolling_avg = np.convolve(arr, window, mode='valid')
    quad_mean = np.mean(np.power(rolling_avg, 4))
    return round(float(quad_mean ** 0.25))

def compute_elevation_changes(altitude_stream, smoothing_window=5):
    """Součet kladných/záporných převýšení z (vyhlazeného) streamu nadmořské výšky."""
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

# Standardní průměr kola dráhové (track) pevné převodovky v palcích - stejná konstanta jako
# `calcGearInches()` v src/app/activities/[id]/page.js, aby oba výpočty souhlasily.
TRACK_WHEEL_DIAMETER_INCHES = 26.8

def gear_development_m(chainring, cog, wheel_diameter_inches=TRACK_WHEEL_DIAMETER_INCHES):
    """Vzdálenost (v metrech), kterou kolo urazí za jednu otáčku klik u fixed-gear dráhového kola."""
    gear_inches = (float(chainring) / float(cog)) * wheel_diameter_inches
    return gear_inches * math.pi * 0.0254  # palce -> metry

EARTH_RADIUS_M = 6371000

def haversine_m(lat1, lon1, lat2, lon2):
    """Vzdušná vzdálenost (v metrech) mezi dvěma GPS souřadnicemi (ve stupních)."""
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

    # FIT ukládá GPS souřadnice v semicircles -> stupně: deg = semicircles * (180 / 2^31)
    SEMICIRCLE_TO_DEG = 180.0 / (2 ** 31)

    for record in fitfile.get_messages('record'):
        vals = record.get_values()
        
        # Power
        w = vals.get('power', 0) or 0
        watts_stream.append(int(w))
        
        # Cadence
        c = vals.get('cadence', 0) or 0
        cadence_stream.append(int(c))
        
        # Speed: FIT ukládá v m/s -> převod na km/h. Novější/rychlejší zařízení posílají
        # "enhanced_speed" místo (nebo navíc k) klasickému "speed" poli - pokud bychom ho
        # ignorovali, rychlost by vypadala jako chybějící, přestože v souboru je.
        s = vals.get('enhanced_speed')
        if s is None:
            s = vals.get('speed', 0.0)
        s = s or 0.0
        speed_stream.append(round(float(s) * 3.6, 1))
        
        # Heart rate
        hr = vals.get('heart_rate')
        if hr is not None:
            hr_stream.append(int(hr))

        # Časové razítko záznamu (pro start_time / elapsed_time i GPS dt níže)
        ts = vals.get('timestamp')
        if ts is not None:
            timestamp_stream.append(ts)

        # GPS pozice (pokud jízda obsahuje satelitní záznam, např. silniční trénink)
        lat_raw = vals.get('position_lat')
        lng_raw = vals.get('position_long')
        if lat_raw is not None and lng_raw is not None:
            lat_deg = round(lat_raw * SEMICIRCLE_TO_DEG, 6)
            lng_deg = round(lng_raw * SEMICIRCLE_TO_DEG, 6)
            lat_stream.append(lat_deg)
            lng_stream.append(lng_deg)
            gps_points.append((lat_deg, lng_deg, ts))

        # Nadmořská výška
        alt = vals.get('altitude') or vals.get('enhanced_altitude')
        if alt is not None:
            altitude_stream.append(round(float(alt), 1))

        # Kumulativní vzdálenost (metry) - pokud zařízení pole posílá
        dist = vals.get('distance')
        if dist is not None:
            distance_stream.append(float(dist))
            
    # Dopočet točivého momentu (Torque v Nm) z W a RPM: T = (P * 60) / (2 * pi * RPM)
    torque_stream = []
    for w, c in zip(watts_stream, cadence_stream):
        if c > 0 and w > 0:
            t = (w * 60.0) / (2.0 * math.pi * c)
            torque_stream.append(round(t, 1))
        else:
            torque_stream.append(0.0)

    # Rychlost/vzdálenost nejsou vždy k dispozici přímo - podle toho, co zařízení umí zaznamenat,
    # volíme v tomto pořadí (viz issue #12 diskuze o fixed-gear dráhových kolech vs. silniční
    # jízdy s volnoběhem):
    #   1) "sensor"             - soubor obsahuje reálný (nenulový) rychlostní signál
    #   2) "gps"                - žádný rychlostní senzor, ale je k dispozici GPS trasa -> rychlost
    #                             a vzdálenost dopočítáme z polohy (funguje i pro volnoběh/road bike)
    #   3) "derived_from_cadence" - žádný senzor ani GPS, ale jde o fixed-gear (dráhové) kolo
    #                             s kadencí a známým převodem -> rychlost = f(kadence, převod)
    #   4) "unavailable"        - nic z výše uvedeného není k dispozici; raději to přiznáme, než
    #                             abychom tiše ukazovali nulu/chybná data
    gps_distance_m = None
    has_speed_signal = any(v > 0 for v in speed_stream)
    if has_speed_signal:
        speed_source = 'sensor'
    elif len(gps_points) > 1:
        gps_speed_kmh, gps_distance_m = derive_speed_and_distance_from_gps(gps_points)
        # GPS body jsou řídké (zaznamenány jen když je fix) - namapujeme je zpět na plný,
        # vteřinový speed_stream podle indexu nejbližšího staršího GPS bodu, aby graf/souhrny
        # zůstaly zarovnané se zbytkem streamů.
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

    # Čas: elapsed = od prvního do posledního záznamu; moving = pouze vteřiny s rychlostí > 1 km/h
    # (FIT záznamy jsou typicky vzorkovány ~1Hz, proto 1 vzorek ~= 1 sekunda)
    if len(timestamp_stream) >= 2:
        start_time = timestamp_stream[0]
        elapsed_time_s = (timestamp_stream[-1] - timestamp_stream[0]).total_seconds()
    else:
        start_time = timestamp_stream[0] if timestamp_stream else None
        elapsed_time_s = float(max(len(watts_stream) - 1, 0))

    MOVING_SPEED_THRESHOLD_KMH = 1.0
    # Pokud nemáme žádný způsob, jak rychlost zjistit/dopočítat, je poctivější vrátit None než
    # tiše předstírat 0 vteřin v pohybu.
    moving_time_s = (
        float(sum(1 for s in speed_stream if s > MOVING_SPEED_THRESHOLD_KMH))
        if speed_source != 'unavailable'
        else None
    )

    # Vzdálenost: preferujeme kumulativní pole z FIT souboru (nejpřesnější, nezávislé na tom, jak
    # jsme dopočítali rychlost), dál GPS trasu (pokud jsme ji použili k odvození rychlosti výše),
    # jinak integrujeme (dopočítanou nebo reálnou) rychlost. Bez žádného z toho necháváme None.
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
    """Minimální parser pro multipart/form-data bez závislosti na cgi modulu
    (odstraněn v novějších verzích Pythonu). Vrací dict name -> (filename, content_bytes)."""
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
    """Vercel Python Function entrypoint: třída musí být přesně pojmenovaná `handler`
    a dědit z BaseHTTPRequestHandler, jinak Vercel soubor nerozpozná jako funkci."""

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

            # Volitelný převod (chainring/cog) odesílaný uploaderem - použije se k dopočtu
            # rychlosti z kadence, pokud .fit soubor neobsahuje reálný rychlostní senzor
            # (typické pro dráhová kola bez GPS/kola čidla).
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

            # Je tato jízda na fixed-gear (dráhovém) kole bez volnoběhu? Pokud ano a soubor
            # neobsahuje rychlostní senzor ani GPS, smíme rychlost bezpečně dopočítat z kadence -
            # u kola s volnoběhem (silniční jízda) by to bylo zavádějící (jezdec může šlapat
            # naprázdno nebo jet bez šlapání z kopce).
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