"""Index completed F1Archive Grand Prix races with telemetry."""
import argparse
import datetime
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1] / "public" / "replays"
BASE = "https://f1archive.org/api/v1/seasons/"


def catalog(years, cache):
    bundled = json.loads((ROOT / "index.json").read_text())
    seen = {(race["year"], race["name"]) for race in bundled}
    races = []
    for year in years:
        if cache:
            season = json.loads((cache / f"{year}.json").read_text())
        else:
            with urllib.request.urlopen(BASE + str(year), timeout=30) as response:
                season = json.load(response)
        for event in season["events"]:
            for session in event["sessions"]:
                if (session["kind"] != "race" or session["status"] != "archived"
                        or not session["has_telemetry"] or (year, event["name"]) in seen):
                    continue
                races.append({"id": session["key"], "name": event["name"], "circuit": event["circuit"],
                              "year": year, "date": session["start_utc"][:10]})
    return sorted(races, key=lambda race: (race["date"], race["id"]), reverse=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--through", type=int, default=datetime.date.today().year)
    parser.add_argument("--cache", type=pathlib.Path, help="Local copies of the provider season responses")
    options = parser.parse_args()
    races = catalog(range(2018, options.through + 1), options.cache)
    (ROOT / "archive.json").write_text(json.dumps(races, ensure_ascii=False, indent=1) + "\n")
    print(f"Indexed {len(races)} archived races in addition to the bundled recordings.")
