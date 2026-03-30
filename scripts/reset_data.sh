#!/usr/bin/env bash
cd "$(dirname "$0")/.." && rm -f data/*.json && echo "Data reset — restart server to re-seed."
