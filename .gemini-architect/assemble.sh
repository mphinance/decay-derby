#!/bin/bash
# Assemble the architect prompt with actual file contents
PROMPT_TEMPLATE=".gemini-architect/round1_prompt.md"
OUT=".gemini-architect/round1_assembled.md"

# Read template
PROMPT=$(cat "$PROMPT_TEMPLATE")

# Inline each file
for placeholder_file in \
  "PLACEHOLDER_INDEX:docs/index.html" \
  "PLACEHOLDER_CSS:docs/css/styles.css" \
  "PLACEHOLDER_PORTFOLIO:docs/js/portfolio.js" \
  "PLACEHOLDER_TRACKER:docs/js/tracker.js" \
  "PLACEHOLDER_SCREENER:docs/js/screener.js" \
  "PLACEHOLDER_SUBSTACK:docs/js/substack.js" \
  "PLACEHOLDER_APP:docs/js/app.js" \
  "PLACEHOLDER_DATA:docs/data/daily/2026-04-21.json"; do
  
  PLACEHOLDER="${placeholder_file%%:*}"
  FILE="${placeholder_file##*:}"
  
  if [ -f "$FILE" ]; then
    CONTENT=$(cat "$FILE")
    # Use awk for safe multi-line replacement
    PROMPT=$(echo "$PROMPT" | awk -v placeholder="$PLACEHOLDER" -v content="$CONTENT" '{gsub(placeholder, content)}1')
  fi
done

echo "$PROMPT" > "$OUT"
echo "✓ Assembled prompt: $(wc -c < "$OUT") bytes"
