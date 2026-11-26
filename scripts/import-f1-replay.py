"""Build a browser replay from a completed OpenF1 race session."""
import argparse
import bisect
import datetime as dt
import json
import math
import pathlib
import time
import urllib.parse
import urllib.request

OUTPUT = pathlib.Path(__file__).resolve().parents[1] / "public" / "replays"
COMPOUNDS = {"SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"}
SAMPLE_MS = 500


def timestamp(value):
    return round(dt.datetime.fromisoformat(value).timestamp() * 1000)


def request(endpoint, **params):
    url = f"https://api.openf1.org/v1/{endpoint}?{urllib.parse.urlencode(params)}"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if attempt == 3 or error.code not in (429, 500, 502, 503, 504):
                raise
            time.sleep(max(10, int(error.headers.get("Retry-After", "0"))))
    raise RuntimeError(f"Could not download {endpoint}")


def source(cache, session):
    directory = cache / str(session)
    directory.mkdir(parents=True, exist_ok=True)

    def get(endpoint, driver=None):
        name = endpoint if driver is None else f"{endpoint}-{driver}"
        file = directory / f"{name}.json"
        if file.exists():
            data = json.loads(file.read_text())
            if isinstance(data, list):
                return data
        time.sleep(2.1)
        extra = {"driver_number": driver} if driver is not None else {}
        data = request(endpoint, session_key=session, **extra)
        file.write_text(json.dumps(data, separators=(",", ":")))
        return data

    return get


def write(file, data):
    temporary = file.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False, allow_nan=False))
    temporary.replace(file)


def sampled_positions(rows, start, end):
    raw = sorted((timestamp(r["date"]) - start, r["x"], r["y"], r["z"]) for r in rows
                 if (r["x"] or r["y"]) and timestamp(r["date"]) <= start + end + SAMPLE_MS)
    if not raw:
        return []
    times = [r[0] for r in raw]
    samples = []
    for t in range(0, end + SAMPLE_MS, SAMPLE_MS):
        right = bisect.bisect_right(times, t)
        a = raw[max(0, right - 1)]
        b = raw[min(len(raw) - 1, right)]
        if a[0] == b[0] or b[0] - a[0] > 3000:
            values = a[1:]
        else:
            weight = (t - a[0]) / (b[0] - a[0])
            values = [round(x + (y - x) * weight) for x, y in zip(a[1:], b[1:])]
        samples.extend(values)
    return samples


def sampled_telemetry(rows, start, end):
    raw = sorted((timestamp(r["date"]) - start, r["speed"], r["n_gear"], r["throttle"], r["brake"])
                 for r in rows if r["date"] and all(r[field] is not None for field in ("speed", "n_gear", "throttle", "brake")))
    times = [r[0] for r in raw]
    samples = []
    for t in range(0, end + 1000, 1000):
        index = bisect.bisect_right(times, t) - 1
        samples.extend(raw[index][1:] if index >= 0 and t - times[index] < 3000 else (-1, 0, 0, 0))
    return samples


def build(session, cache, title):
    get = source(cache, session)
    metadata, = get("sessions")
    if metadata["session_name"] != "Race" or metadata.get("is_cancelled"):
        raise ValueError("Select a completed Grand Prix race session.")
    results = {row["driver_number"]: row for row in get("session_result")}
    if not results or not any(r["position"] == 1 for r in results.values()):
        raise ValueError("Final race classification is unavailable.")
    control = sorted(get("race_control"), key=lambda row: timestamp(row["date"]))
    start = next(timestamp(r["date"]) for r in control if r["message"] == "SESSION STARTED")
    to_ms = lambda row, field="date": timestamp(row[field]) - start
    total_laps = max(r["number_of_laps"] for r in results.values())
    laps, stints, pits, positions, intervals = (get(endpoint) for endpoint in
        ("laps", "stints", "pit", "position", "intervals"))
    weather = get("weather")

    finish_times = [to_ms(row, "date_start") + round(row["lap_duration"] * 1000) for row in laps
                    if row["date_start"] and row["lap_duration"] and row["lap_number"] == results[row["driver_number"]]["number_of_laps"]
                    and not results[row["driver_number"]]["dnf"]]
    duration = max(finish_times)
    race_drivers = {}
    for driver in get("drivers"):
        number = driver["driver_number"]
        result = results.get(number)
        if not result or result["dns"]:
            continue
        rows = lambda dataset: [row for row in dataset if row["driver_number"] == number]
        driver_laps = sorted((max(0, to_ms(r, "date_start")), r["lap_number"], r["lap_duration"],
                              [r[f"duration_sector_{i}"] for i in range(1, 4)])
                             for r in rows(laps) if r["date_start"])
        if not driver_laps:
            continue
        entries = sorted((r["lap_number"], round(r["lane_duration"] * 1000) if r["lane_duration"] else None, to_ms(r))
                         for r in rows(pits) if to_ms(r) >= 0)
        stops = []
        for lap, lane_ms, exit_ms in entries:
            next_lap = next((time_ms for time_ms, n, _, _ in driver_laps if n == lap + 1), exit_ms)
            # The pit timestamp is the report at pit exit. Use the lap boundary as
            # a fallback when a lane duration is unavailable.
            entry_ms = max(0, exit_ms - lane_ms) if lane_ms else max(0, min(exit_ms, next_lap))
            stops.append((entry_ms, max(exit_ms, entry_ms), lap))
        driver_stints = []
        for r in sorted(rows(stints), key=lambda row: row["stint_number"]):
            lap = r["lap_start"]
            lap_time = next((time_ms for time_ms, n, _, _ in driver_laps if n >= lap), duration)
            stop = next((p for p in stops if p[2] == lap - 1), None)
            compound = r["compound"]
            driver_stints.append((stop[1] if stop else lap_time, lap, compound.lower() if compound in COMPOUNDS else None, r["tyre_age_at_start"]))
        leaderboard = sorted(((to_ms(r), r["position"]) for r in rows(positions)), key=lambda row: row[0])
        gaps = sorted(((to_ms(r), r["interval"], r["gap_to_leader"]) for r in rows(intervals)), key=lambda row: row[0])
        if result["dnf"]:
            last = driver_laps[-1]
            retirement = next((to_ms(row) for row in control if row["driver_number"] == number and
                               any(word in row["message"].upper() for word in ("RETIRED", "STOPPED")) and to_ms(row) >= last[0]), None)
            end = retirement if retirement is not None else last[0] + round((last[2] or 90) * 1000)
        else:
            last = driver_laps[-1]
            end = last[0] + round((last[2] or 0) * 1000)
        race_drivers[str(number)] = {
            "number": number, "code": driver["name_acronym"], "name": f'{driver["first_name"]} {driver["last_name"]}',
            "team": driver["team_name"], "color": f'#{driver["team_colour"] or "a0a0a0"}',
            "laps": driver_laps, "stints": sorted(driver_stints), "pits": sorted(stops),
            "positions": [p for i, p in enumerate(leaderboard) if p[0] >= 0 or i == len(leaderboard) - 1 or leaderboard[i+1][0] >= 0],
            "gaps": [g for i, g in enumerate(gaps) if g[0] >= 0 or i == len(gaps) - 1 or gaps[i+1][0] >= 0],
            "end": min(duration, end), "out": bool(result["dnf"]), "finish": result["position"],
        }
    if not race_drivers:
        raise ValueError("Timing data is unavailable.")
    locations = {}
    telemetry = {}
    for number, driver in race_drivers.items():
        print(f'Position samples for {driver["code"]}', flush=True)
        locations[number] = sampled_positions(get("location", int(number)), start, driver["end"])
        telemetry[number] = sampled_telemetry(get("car_data", int(number)), start, driver["end"])
    # A clean, fast lap provides a circuit outline in the same coordinates as the cars.
    clean_laps = sorted((r["lap_duration"], r["driver_number"], to_ms(r, "date_start")) for r in laps
                        if r["date_start"] and r["lap_duration"] and r["lap_number"] > 2
                        and str(r["driver_number"]) in locations and locations[str(r["driver_number"])]
                        and not r["is_pit_out_lap"] and not any(p[2] == r["lap_number"] for p in race_drivers[str(r["driver_number"])]["pits"]))
    outline = []
    for lap_time, number, lap_start in clean_laps:
        points = locations[str(number)][round(lap_start / SAMPLE_MS) * 3:round((lap_start + lap_time * 1000) / SAMPLE_MS) * 3]
        outline = [points[i:i+3] for i in range(0, len(points), 3)]
        if len(outline) > 50 and math.dist(outline[0], outline[-1]) < 1100:
            break
    else:
        raise ValueError("No closed circuit outline could be drawn from the position data.")
    descriptor = {"id": str(session), "name": title or f'{metadata["country_name"]} Grand Prix',
                  "circuit": metadata["circuit_short_name"], "year": metadata["year"], "laps": total_laps,
                  "date": dt.datetime.fromtimestamp(start / 1000, dt.timezone.utc).date().isoformat()}
    race = {**descriptor, "duration": duration, "drivers": list(race_drivers.values()),
            "control": [[to_ms(r), r["message"], r["flag"], r["scope"], r["category"]] for r in control if 0 <= to_ms(r) <= duration],
            "weather": [[to_ms(r), r["rainfall"] == 1, r["air_temperature"], r["track_temperature"]] for r in weather
                        if -120000 <= to_ms(r) <= duration]}
    OUTPUT.mkdir(parents=True, exist_ok=True)
    write(OUTPUT / f"{session}.json", race)
    write(OUTPUT / f"{session}-positions.json", {"step": SAMPLE_MS, "track": outline, "cars": locations, "telemetry": telemetry})
    index = OUTPUT / "index.json"
    catalog = json.loads(index.read_text()) if index.exists() else []
    write(index, sorted([r for r in catalog if r["id"] != str(session)] + [descriptor], key=lambda r: (r["year"], r["date"]), reverse=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("session", type=int, help="OpenF1 Race session_key")
    parser.add_argument("--name", help="Grand Prix name in the race picker")
    parser.add_argument("--cache", type=pathlib.Path, default=pathlib.Path(".replay-cache"))
    args = parser.parse_args()
    build(args.session, args.cache, args.name)
