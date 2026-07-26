from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
path = root / "src/webview/svgToTrack.ts"
text = path.read_text(encoding="utf-8")
replacements = [
('''      <label for="padding">Circular padding</label>\n      <div class="control-row">\n        <input id="padding" type="range" min="-100" max="20" step="0.5" value="4">\n        <span id="paddingValue" class="value">4.0%</span>\n      </div>\n      <span class="hint">Negative values enlarge the artwork and trim anything outside the circular drawing area.</span>''', '''      <label for="padding">Overscan</label>\n      <div class="control-row">\n        <input id="padding" type="range" min="-1" max="1" step="0.01" value="-0.04">\n        <span id="paddingValue" class="value">-0.04</span>\n      </div>\n      <span class="hint">Positive values enlarge and crop the artwork. Negative values shrink it inside the circle.</span>'''),
('clamp(numberValue(padding, 4), -100, 20)', 'clamp(numberValue(padding, -0.04), -1, 1)'),
('paddingPercent: number', 'overscan: number'),
('const usableRadius = SANDSARA_RADIUS * (1 - paddingPercent / 100);', 'const usableRadius = SANDSARA_RADIUS * (1 + overscan);'),
('return paddingPercent < 0\n    ? clipPathsToCircle(fittedPaths, SANDSARA_RADIUS)\n    : fittedPaths;', 'return overscan > 0\n    ? clipPathsToCircle(fittedPaths, SANDSARA_RADIUS)\n    : fittedPaths;'),
('paddingValue.textContent = `${numberValue(padding, 4).toFixed(1)}%`;', 'paddingValue.textContent = numberValue(padding, -0.04).toFixed(2);'),
]
for old, new in replacements:
    if old not in text:
        raise SystemExit(f"missing source text: {old[:80]!r}")
    text = text.replace(old, new)
path.write_text(text, encoding="utf-8")

changelog = root / "CHANGELOG.md"
ct = changelog.read_text(encoding="utf-8")
start = ct.index("## 0.3.4")
end = ct.index("## 0.3.3")
ct = ct[:start] + '''## 0.3.4 - 2026-07-26\n\n- replaces circular padding with an Overscan control from -1.00 to +1.00\n- uses 0.00 for exact fit, +1.00 for twice-size crop, and -1.00 for zero-size collapse\n- preserves the previous default as -0.04\n- clips enlarged line segments exactly at the circular boundary before routing\n- splits strokes into valid in-circle paths when they leave and re-enter the canvas\n- reuses sampled SVG geometry when Overscan changes\n\n''' + ct[end:]
changelog.write_text(ct, encoding="utf-8")

readme = root / "README.md"
rt = readme.read_text(encoding="utf-8")
rt = rt.replace('Circular padding accepts signed values from -100% to +20%; negative padding enlarges the centred artwork and clips excess geometry precisely at the circular drawing boundary before routing.', 'Overscan ranges from -1.00 to +1.00: 0.00 fits exactly, positive values enlarge and crop at the circular boundary, and negative values shrink the artwork. The previous +4% padding default is represented as -0.04.')
readme.write_text(rt, encoding="utf-8")
