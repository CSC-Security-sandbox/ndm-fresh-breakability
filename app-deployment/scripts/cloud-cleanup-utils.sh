#!/bin/bash
# Common utility functions for cloud resource cleanup workflows

extract_zone() {
  local zone_url=$1
  echo "$zone_url" | sed 's|.*/zones/||'
}

should_exclude() {
  local resource_labels_json=$1
  local exclude_key=$2
  local exclude_value=$3
  
  if [ -n "$resource_labels_json" ] && [ "$resource_labels_json" != "{}" ]; then
    if echo "$resource_labels_json" | jq -e --arg key "$exclude_key" --arg value "$exclude_value" \
      '.[$key] == $value' > /dev/null 2>&1; then
      return 0
    fi
  fi
  
  return 1
}
