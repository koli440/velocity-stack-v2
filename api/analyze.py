import sys
import json
import math
import numpy as np
from fitparse import FitFile

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
        
    summary = {
        'max_power_w': int(max(watts_stream)) if watts_stream else None,
        'max_cadence_rpm': int(max(cadence_stream)) if cadence_stream else None,
        'max_speed_kmh': float(max(speed_stream)) if speed_stream else None,
        'peak_torque_nm': float(max(torque_stream)) if torque_stream else None,
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
            'heartrate': hr_stream
        }
    }
    
    return output

if __name__ == '__main__':
    if len(sys.argv) > 1:
        res = analyze_fit_file(sys.argv[1])
        print(json.dumps(res))