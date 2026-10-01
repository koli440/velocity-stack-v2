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

def analyze_fit_file(file_path):
    fitfile = FitFile(file_path)
    
    watts_stream = []
    cadence_stream = []
    speed_stream = []
    hr_stream = []
    lat_stream = []
    lng_stream = []
    altitude_stream = []

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
        
        # Speed: FIT ukládá v m/s -> převod na km/h
        s = vals.get('speed', 0.0) or 0.0
        speed_stream.append(round(float(s) * 3.6, 1))
        
        # Heart rate
        hr = vals.get('heart_rate')
        if hr is not None:
            hr_stream.append(int(hr))

        # GPS pozice (pokud jízda obsahuje satelitní záznam, např. silniční trénink)
        lat_raw = vals.get('position_lat')
        lng_raw = vals.get('position_long')
        if lat_raw is not None and lng_raw is not None:
            lat_stream.append(round(lat_raw * SEMICIRCLE_TO_DEG, 6))
            lng_stream.append(round(lng_raw * SEMICIRCLE_TO_DEG, 6))

        # Nadmořská výška
        alt = vals.get('altitude') or vals.get('enhanced_altitude')
        if alt is not None:
            altitude_stream.append(round(float(alt), 1))
            
    # Dopočet točivého momentu (Torque v Nm) z W a RPM: T = (P * 60) / (2 * pi * RPM)
    torque_stream = []
    for w, c in zip(watts_stream, cadence_stream):
        if c > 0 and w > 0:
            t = (w * 60.0) / (2.0 * math.pi * c)
            torque_stream.append(round(t, 1))
        else:
            torque_stream.append(0.0)
            
    intervals = [1, 5, 10, 15, 30, 60, 120, 180, 300, 600, 1200, 1800, 3600]
    
    curves = {
        'Power': compute_durational_curve(watts_stream, intervals),
        'Cadence': compute_durational_curve(cadence_stream, intervals),
        'Speed': compute_durational_curve(speed_stream, intervals),
        'Torque': compute_durational_curve(torque_stream, intervals)
    }
    if hr_stream:
        curves['HeartRate'] = compute_durational_curve(hr_stream, intervals)
        
    has_gps = len(lat_stream) > 1

    summary = {
        'max_power_w': int(max(watts_stream)) if watts_stream else None,
        'max_cadence_rpm': int(max(cadence_stream)) if cadence_stream else None,
        'max_speed_kmh': float(max(speed_stream)) if speed_stream else None,
        'peak_torque_nm': float(max(torque_stream)) if torque_stream else None,
        'has_gps': has_gps,
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

            with tempfile.NamedTemporaryFile(suffix='.fit', delete=False) as tmp:
                tmp.write(file_bytes)
                tmp_path = tmp.name

            result = analyze_fit_file(tmp_path)
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