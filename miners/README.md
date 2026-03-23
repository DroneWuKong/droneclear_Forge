# Forge Intel Miners

Python scripts that scrape public drone industry sources and update `forge_intel.json`.

## Usage

```bash
# Run all miners
python3 miners/mine_all.py

# Run individual miners
python3 miners/mine_dronelife.py
python3 miners/mine_sbir.py
python3 miners/mine_blueuas.py
```

## Sources

| Miner | Source | Data Type |
|-------|--------|-----------|
| `mine_dronelife.py` | dronelife.com | Funding, contracts, regulatory news |
| `mine_sbir.py` | sbir.gov | Government SBIR/STTR awards to drone companies |
| `mine_blueuas.py` | DIU Blue UAS portal | Cleared list platforms + framework components |
| `mine_all.py` | Runs all miners, merges results, writes intel JSON |

## Output

All miners write to `DroneClear Components Visualizer/forge_intel.json`.
Existing entries are deduplicated by company+date (funding) or program+awardee (contracts).
