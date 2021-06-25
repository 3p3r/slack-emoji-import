#!/bin/bash -eux

path="${1?' you must supply a directory name where emojipack YAMLs are'}"

for f in "$path"/*.yaml; do
  SLACK_EMOJI_IMPORT_YAML="$f" npm start
done
