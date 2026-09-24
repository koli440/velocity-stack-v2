from http.server import BaseHTTPRequestHandler
import json
import io
import cgi
import numpy as np
import pandas as pd
from fitparse import FitFile

def parse_fit_bytes(file_bytes):
    fitfile = FitFile(io.BytesIO(file_bytes))
    records = []
    
    for record in fitfile.get_messages('record'):
        data = record.get_values()
        
        # Ošetření časových a výkonových dat
        t = data.get('timestamp')
        cad = data.get('cadence')
        pwr = data.get('power')
        spd = data.get('speed') # vteřinové m/s
        hr = data.get('heart_rate')
        
        records.append({
            'timestamp': t,
            'cadence': float(cad) if cad is not None else np.nan,
            'power': float(pwr) if pwr is not None else np.nan,
            'speed_kmh': (float(spd) * 3.6) if spd is not None else np.nan,
            'heart_rate': float(hr) if hr is not None else np.nan
        })
        
    df = pd.DataFrame(records)
    if df.empty:
        return df
        
    # Výpočet Torque (Nm) z Power a Cadence
    def calc_torque(row):
        p = row['power']
        c = row['cadence']
        if pd.notnull(p) and pd.notnull(c) and c > 0:
            return p / (c * (2 * np.pi / 60))
        return 0.0

    df['torque_nm'] = df.apply(calc_torque, axis=1)
    return df

def calculate_durational_curves(df):
    total_seconds = len(df)
    intervals = {
        "1s": 1, "5s": 5, "10s": 10, "15s": 15, "30s": 30,
        "1m": 60, "2m": 120, "5m": 300, "10m": 600,
        "15m": 900, "20m": 1200, "30m": 1800, "45m": 2700, "1h": 3600
    }
    valid_intervals = {lbl: secs for lbl, secs in intervals.items() if total_seconds >= secs}
    
    metrics = {
        'Cadence': 'cadence',
        'Speed': 'speed_kmh',
        'Power': 'power',
        'HeartRate': 'heart_rate',
        'Torque': 'torque_nm'
    }
    
    curves = {}
    for metric_name, col in metrics.items():
        if col in df.columns and df[col].notnull().sum() > 0:
            curve_data = {}
            for label, secs in valid_intervals.items():
                val = df[col].rolling(window=secs, min_periods=secs).mean().max()
                if pd.notnull(val):
                    curve_data[label] = round(float(val), 1)
            if curve_data:
                curves[metric_name] = curve_data
                
    return curves

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            # Čtení multipart/form-data
            ctype, pdict = cgi.parse_header(self.headers.get('content-type'))
            if ctype != 'multipart/form-data':
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Expected multipart/form-data"}).encode())
                return

            pdict['boundary'] = bytes(pdict['boundary'], "utf-8")
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={'REQUEST_METHOD': 'POST', 'CONTENT_TYPE': self.headers['Content-Type']}
            )

            file_item = form['file']
            file_bytes = file_item.file.read()

            df = parse_fit_bytes(file_bytes)
            if df.empty:
                self.send_response(422)
                self.end_headers()
                self.wfile.write(json.dumps({"error": "No records found in FIT file"}).encode())
                return

            curves = calculate_durational_curves(df)

            # Maxima a souhrny
            summary = {
                "max_cadence": int(df['cadence'].max()) if df['cadence'].notnull().any() else None,
                "max_speed_kmh": round(float(df['speed_kmh'].max()), 1) if df['speed_kmh'].notnull().any() else None,
                "max_power_w": int(df['power'].max()) if df['power'].notnull().any() else None,
                "peak_torque_nm": round(float(df['torque_nm'].max()), 1) if df['torque_nm'].notnull().any() else None,
                "duration_sec": len(df)
            }

            response_payload = {
                "summary": summary,
                "curves": curves
            }

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(response_payload).encode())

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
