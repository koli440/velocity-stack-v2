-- Import of v1's "Tracks" Google Sheet worksheet (130-row export; 7 rows merged with their
-- predecessor during CSV re-parsing due to embedded newlines in the Notes column, leaving 123
-- distinct track records) into public.tracks.
--
-- v1 (koli440/velocity-stack) used a Google Sheet as its database via streamlit_gsheets. The
-- `tracks` table created in 20260924000000_init_schema.sql only ever seeded 3 tracks (Dick Lane
-- Velodrome, Trebesin Velodrome, Lviv Velodrome (SKA)) as fixtures for the UI feature migration -
-- the full v1 track catalogue was never actually imported. This migration imports the rest.
--
-- Dedup: 3 of the 123 sheet rows are the same tracks as the existing 3 seed rows under
-- slightly different names/precision ("Praha - Trebesin" 333.3m CZE == "Trebesin Velodrome"
-- 333.33m CZE; "Dick Lane Velodrome" USA and "Lviv Velodrome (SKA)" UKR match verbatim). We match
-- by country_code + length_m (rounded to the nearest meter) + lat/lon (within ~0.01 degrees) to
-- skip those and only insert the ~120 genuinely-missing tracks, guarded by a NOT EXISTS check so
-- this migration is idempotent and safe to re-run.
--
-- Known gap: v1's Indoor (boolean) column has no corresponding column in v2's `tracks` schema and
-- is intentionally skipped here (out of scope - no new column added). banking_deg and location
-- also have no v1 equivalent and are left NULL.

INSERT INTO public.tracks (name, country_code, length_m, surface, elevation_m, latitude, longitude, notes)
SELECT v.name, v.country_code, v.length_m, v.surface, v.elevation_m, v.latitude, v.longitude, v.notes
FROM (
    VALUES
('Praha - Motol', 'CZE', 153.8, 'Wood', 280, 50.0651975, 14.3462459, 'test'),
('Brno - Favorit', 'CZE', 400.0, 'Concrete', 220, 49.1869, 16.5815, NULL),
('Konya Velodrome', 'TUR', 250.0, 'Wood', 1020, 37.9351, 32.5122, NULL),
('Gent - Vlaams Wielercentrum Eddy Merckx', 'BEL', 250.0, 'Wood', 10, 51.0475, 3.6939, NULL),
('Heusden-Zolder - Velodroom', 'BEL', 250.0, 'Wood', 40, 51.0185, 5.2585, NULL),
('Alkmaar - Sportpaleis', 'NED', 250.0, 'Wood', 2, 52.6395, 4.7235, NULL),
('Rotterdam - Ahoy', 'NED', 200.0, 'Wood', 0, 51.8833, 4.4833, NULL),
('Plovdiv - Kolodruma', 'BUL', 250.0, 'Wood', 160, 42.1332, 24.7672, NULL),
('Athens - Olympic Velodrome', 'GRE', 250.0, 'Wood', 200, 38.0366, 23.7828, NULL),
('Linz - TipsArena', 'AUT', 200.0, 'Wood', 260, 48.2985, 14.2742, NULL),
('Panevėžys - Cido Arena', 'LTU', 250.0, 'Wood', 50, 55.7325, 24.3395, NULL),
('Carson - Velo Sports Center', 'USA', 250.0, 'Wood', 15, 33.8645, -118.2615, NULL),
('Rock Hill - Giordana Velodrome', 'USA', 250.0, 'Concrete', 200, 34.9655, -80.9925, NULL),
('Detroit - Lexus Velodrome', 'USA', 166.0, 'Wood', 180, 42.3485, -83.0535, NULL),
('Redmond - Marymoor Velodrome', 'USA', 400.0, 'Concrete', 10, 47.6635, -122.1085, NULL),
('Indianapolis - Major Taylor Velodrome', 'USA', 333.3, 'Concrete', 220, 39.8245, -86.2085, NULL),
('San Jose - Hellyer Park Velodrome', 'USA', 333.3, 'Concrete', 45, 37.2865, -121.8215, NULL),
('Bromont - Centre National de Cyclisme', 'CAN', 250.0, 'Wood', 180, 45.3115, -72.6985, NULL),
('Beijing - Laoshan Velodrome', 'CHN', 250.0, 'Wood', 50, 39.9115, 116.2065, NULL),
('Hong Kong - HK Velodrome', 'CHN', 250.0, 'Wood', 5, 22.3145, 114.2635, NULL),
('Chun''an - Jieshou Velodrome', 'CHN', 250.0, 'Wood', 120, 29.4855, 118.8925, NULL),
('Maebashi - Green Dome', 'JPN', 333.3, 'Wood', 100, 36.3985, 139.0615, NULL),
('Nilai - National Velodrome', 'MAS', 250.0, 'Wood', 50, 2.8185, 101.7855, NULL),
('New Delhi - IGI Velodrome', 'IND', 250.0, 'Wood', 215, 28.6295, 77.2495, NULL),
('Astana - Saryarka Velodrome', 'KAZ', 250.0, 'Wood', 350, 51.1095, 71.4035, NULL),
('Bangkok - Huamark Velodrome', 'THA', 333.3, 'Concrete', 5, 13.7575, 100.6225, NULL),
('Jakarta - International Velodrome', 'INA', 250.0, 'Wood', 5, -6.1925, 106.8835, NULL),
('Brisbane - Anna Meares Velodrome', 'AUS', 250.0, 'Wood', 20, -27.5095, 153.1165, NULL),
('Perth - SpeedDome', 'AUS', 250.0, 'Wood', 15, -31.8945, 116.0025, NULL),
('Melbourne - DISC', 'AUS', 250.0, 'Wood', 40, -37.7725, 145.0215, NULL),
('Sydney - Dunc Gray Velodrome', 'AUS', 250.0, 'Wood', 25, -33.9185, 150.9855, NULL),
('Cambridge - Avantidrome', 'NZL', 250.0, 'Wood', 40, -37.8935, 175.4435, NULL),
('Invercargill - SIT Zero Fees Velodrome', 'NZL', 250.0, 'Wood', 5, -46.4115, 168.3755, NULL),
('Pruskow - Arena', 'POL', 250.0, 'Wood', 99, 52.1635, 20.8192, NULL),
('London - Lee Valley VeloPark', 'GBR', 250.0, 'Wood', 15, 51.5505, -0.0153, NULL),
('Manchester - National Cycling Centre', 'GBR', 250.0, 'Wood', 38, 53.4854, -2.1915, NULL),
('Glasgow - Sir Chris Hoy Velodrome', 'GBR', 250.0, 'Wood', 10, 55.8472, -4.2084, NULL),
('Derby - Derby Arena', 'GBR', 250.0, 'Wood', 45, 52.9152, -1.4475, NULL),
('Newport - Geraint Thomas Velodrome', 'GBR', 250.0, 'Wood', 15, 51.5743, -2.9574, NULL),
('London - Herne Hill Velodrome', 'GBR', 450.0, 'Bitumen', 30, 51.4517, -0.0917, NULL),
('Cardiff - Maindy Stadium', 'GBR', 460.0, 'Concrete', 10, 51.4969, -3.19, NULL),
('Portsmouth - Mountbatten Centre', 'GBR', 536.0, 'Tarmac', 2, 50.8228, -1.0858, NULL),
('Middlesbrough - Sports Village', 'GBR', 250.0, 'Tarmac', 15, 54.5492, -1.2185, NULL),
('Reading - Palmer Park', 'GBR', 459.0, 'Tarmac', 45, 51.4503, -0.9422, NULL),
('Calshot - Calshot Velodrome', 'GBR', 143.0, 'Wood', 2, 50.8194, -1.3117, NULL),
('Bournemouth - Slades Park', 'GBR', 250.0, 'Asphalt', 35, 50.7512, -1.9055, NULL),
('Scunthorpe - Quibell Park', 'GBR', 485.0, 'Tarmac', 10, 53.5936, -0.6722, NULL),
('Paris - Vélodrome National (SQY)', 'FRA', 250.0, 'Wood', 160, 48.7881, 2.0345, NULL),
('Roubaix - Stab Vélodrome', 'FRA', 250.0, 'Wood', 32, 50.6811, 3.2065, NULL),
('Bordeaux - Stadium Vélodrome', 'FRA', 250.0, 'Wood', 5, 44.8967, -0.5633, NULL),
('Hyères - Vélodrome Toulon Provence', 'FRA', 250.0, 'Wood', 10, 43.1115, 6.1305, NULL),
('Bourges - Vélodrome de Bourges', 'FRA', 200.0, 'Wood', 150, 47.0705, 2.3855, NULL),
('Grenoble - Palais des Sports', 'FRA', 210.0, 'Wood', 210, 45.1855, 5.7405, NULL),
('Saint-Denis - Vélodrome de Saint-Denis', 'FRA', 250.0, 'Wood', 35, 48.9405, 2.3555, NULL),
('Lyon - Vélodrome du Parc de la Tête d''Or', 'FRA', 333.3, 'Concrete', 170, 45.7825, 4.8565, NULL),
('Marseille - Vélodrome Jean Bouin', 'FRA', 400.0, 'Concrete', 20, 43.2725, 5.3955, NULL),
('Roubaix - Vélodrome André-Pétrieux', 'FRA', 499.0, 'Concrete', 30, 50.6785, 3.2055, NULL),
('Palma de Mallorca - Velòdrom Illes Balears', 'ESP', 250.0, 'Wood', 25, 39.5885, 2.6455, NULL),
('Valencia - Velódromo Luis Puig', 'ESP', 250.0, 'Wood', 40, 39.5015, -0.4285, NULL),
('Galapagar - Velódromo Municipal', 'ESP', 250.0, 'Wood', 890, 40.5833, -3.9915, NULL),
('Barcelona - Velòdrom d''Horta', 'ESP', 250.0, 'Wood', 150, 41.4365, 2.1525, NULL),
('Tafalla - Velódromo Miguel Induráin', 'ESP', 250.0, 'Wood', 430, 42.5215, -1.6745, NULL),
('Anoeta (San Sebastián) - Velódromo Antonio Elorza', 'ESP', 285.0, 'Wood', 20, 43.3015, -1.9725, NULL),
('Sangalhos - Velódromo Nacional', 'POR', 250.0, 'Wood', 85, 40.4795, -8.4725, NULL),
('Loulé - Velódromo de Loulé', 'POR', 400.0, 'Concrete', 100, 37.1355, -8.0215, NULL),
('Tavira - Velódromo de Tavira', 'POR', 400.0, 'Concrete', 15, 37.1285, -7.6525, NULL),
('Montichiari - Velodromo Fassa Bortolo', 'ITA', 250.0, 'Wood', 105, 45.4125, 10.3955, NULL),
('Milano - Velodromo Vigorelli', 'ITA', 397.0, 'Wood', 120, 45.4815, 9.1555, NULL),
('Fiorenzuola d''Arda - Velodromo Attilio Pavesi', 'ITA', 394.0, 'Concrete', 80, 44.9275, 9.9125, NULL),
('Dalmine - Velodromo di Dalmine', 'ITA', 374.0, 'Concrete', 200, 45.6485, 9.6055, NULL),
('Bassano del Grappa - Velodromo Rino Mercante', 'ITA', 400.0, 'Concrete', 130, 45.7595, 11.7255, NULL),
('Noto - Velodromo Paolo Pilone', 'ITA', 333.0, 'Concrete', 150, 36.8855, 15.0755, NULL),
('Cochabamba - Velódromo de Cochabamba', 'BOL', 250.0, 'Wood', 2558, -17.382, -66.143, NULL),
('Aguascalientes - Velódromo Bicentenario', 'MEX', 250.0, 'Wood', 1887, 21.8615, -102.2619, NULL),
('Cali - Velódromo Alcides Nieto Patiño', 'COL', 250.0, 'Wood', 1003, 3.4114, -76.5508, NULL),
('San Juan - Velódromo Vicente Alejo Chancay', 'ARG', 250.0, 'Wood', 650, -31.517, -68.583, NULL),
('Mexico City - Velódromo Agustín Melgar', 'MEX', 333.0, 'Wood', 2240, 19.4086, -99.1031, NULL),
('Santiago - Velódromo Peñalolén', 'CHI', 250.0, 'Wood', 660, -33.483, -70.548, NULL),
('Lima - Velódromo de la Videna', 'PER', 250.0, 'Wood', 150, -12.076, -77.001, NULL),
('Arima - National Cycling Centre', 'TTO', 250.0, 'Wood', 30, 10.635, -61.278, NULL),
('Rio de Janeiro - Velódromo Olímpico', 'BRA', 250.0, 'Wood', 5, -22.978, -43.394, NULL),
('Medellín - Velódromo Martín Emilio Rodríguez', 'COL', 250.0, 'Concrete', 1490, 6.258, -75.589, NULL),
('Valencia - Velódromo Máximo Viloria', 'VEN', 250.0, 'Wood', 480, 10.175, -67.952, NULL),
('Berlin - Velodrom Berlin', 'GER', 250.0, 'Wood', 35, 52.5305, 13.4505, NULL),
('Cottbus - Velodrom Cottbus', 'GER', 250.0, 'Concrete', 75, 51.7455, 14.3385, NULL),
('Frankfurt (Oder) - Oderlandhalle', 'GER', 250.0, 'Wood', 40, 52.3405, 14.5305, NULL),
('Büttgen - Sportforum Kaarst-Büttgen', 'GER', 250.0, 'Wood', 40, 51.1955, 6.6155, NULL),
('Augsburg - Peter-Krauss-Velodrom', 'GER', 200.0, 'Wood', 490, 48.3455, 10.8655, NULL),
('Dudenhofen - Badewanne (The Bathtub)', 'GER', 250.0, 'Concrete', 100, 49.3155, 8.3855, NULL),
('Erfurt - Radrennbahn Andreasried', 'GER', 250.0, 'Concrete', 200, 51.0005, 11.0205, NULL),
('Gera - Radrennbahn Gera', 'GER', 250.0, 'Concrete', 190, 50.8855, 12.0655, NULL),
('Leipzig - Radrennbahn Leipzig', 'GER', 400.0, 'Concrete', 115, 51.3455, 12.3555, NULL),
('Sineu - Pista d''atletisme', 'ESP', 333.0, 'Concrete', 118, 39.6431074, 3.0018573, NULL),
('Velodrom Novo Mesto', 'SLO', 250.0, 'Wood', 185, 45.805637, 15.1264555, NULL),
('Tissot Velodrome (Grenchen)', 'SUI', 250.0, 'Wood', 451, 47.1935, 7.3914, NULL),
('Velodrome Suisse (Aigle)', 'SUI', 200.0, 'Wood', 415, 46.3186, 6.9272, NULL),
('Offene Rennbahn (Zurich-Oerlikon)', 'SUI', 333.0, 'Concrete', 443, 47.4111, 8.5486, NULL),
('Ballerup Super Arena', 'DNK', 250.0, 'Wood', 28, 55.7202, 12.3592, NULL),
('Aarhus Cyklebane', 'DNK', 333.0, 'Concrete', 35, 56.1364, 10.1911, NULL),
('Odense Cyklebane', 'DNK', 250.0, 'Wood', 20, 55.3995, 10.3475, NULL),
('Sola Arena (Stavanger)', 'NOR', 250.0, 'Wood', 10, 58.8912, 5.6231, NULL),
('Asker Velodrom', 'NOR', 200.0, 'Wood', 105, 59.8322, 10.4356, NULL),
('YA Arena (Falun)', 'SWE', 190.0, 'Wood', 165, 60.6055, 15.6514, NULL),
('Helsinki Velodrome', 'FIN', 400.0, 'Concrete', 15, 60.2017, 24.9419, NULL),
('Izu Velodrome (Shizuoka)', 'JPN', 250.0, 'Wood', 315, 34.9925, 138.9861, NULL),
('Chiba JPF Dome', 'JPN', 250.0, 'Wood', 5, 35.6133, 140.1114, NULL),
('Kokura Media Dome', 'JPN', 400.0, 'Timber', 12, 33.8797, 130.8858, NULL),
('Tokyo Oval Keiokaku', 'JPN', 400.0, 'Asphalt', 38, 35.6422, 139.5342, NULL),
('Lusail Shooting Club Velodrome', 'QAT', 250.0, 'Wood', 15, 25.4851, 51.4111, NULL),
('Dubai Sharjah Velodrome', 'ARE', 250.0, 'Wood', 10, 25.2922, 55.4831, NULL),
('Sylvan Adams Velodrome (Tel Aviv)', 'ISR', 250.0, 'Wood', 35, 32.1031, 34.8055, NULL),
('Mattamy National Cycling Centre (Milton)', 'CAN', 250.0, 'Wood', 215, 43.4882, -79.8512, NULL),
('Olympic Oval (Calgary)', 'CAN', 450.0, 'Concrete', 1105, 51.0772, -114.1352, NULL),
('Burnaby Velodrome', 'CAN', 200.0, 'Wood', 15, 49.2514, -122.9556, NULL),
('VeloDome (Tucson)', 'USA', 250.0, 'Aluminium', 725, 32.2226, -110.9747, NULL),
('Penrose Park Velodrome', 'USA', 322.0, 'Concrete', 145, 38.6849, -90.2458, 'https://www.penroseparkvelo.com/

Saint Louis, MO'),
('Northeast Velodrome', 'USA', 333.0, 'Asphalt', 68, 42.921, -71.4143, 'https://northeastvelodrome.wordpress.com/'),
('Valley Preferred Cycling Center', 'USA', 333.0, 'Concrete', 121, 40.5473, -75.6105, 'https://thevelodrome.com/'),
('Juan de Fuca Velodrome', 'CAN', 333.0, 'Concrete', 80, 48.443429, -123.464457, 'Located in the Juan de Fuca Rec Centre, just outside of Victoria BC. Alternatively called the Victoria Velodrome.
1767 Island Hwy, Victoria, BC V9B 1J1, Canada
gvva.bc.ca')
) AS v(name, country_code, length_m, surface, elevation_m, latitude, longitude, notes)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.tracks t
    WHERE t.country_code = v.country_code
      AND t.latitude IS NOT NULL
      AND v.latitude IS NOT NULL
      AND round(t.length_m) = round(v.length_m)
      AND abs(t.latitude - v.latitude) <= 0.01
      AND abs(t.longitude - v.longitude) <= 0.01
)
ON CONFLICT (name) DO NOTHING;
