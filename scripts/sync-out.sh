#!/bin/bash
# Packs the working tree (minus node_modules/build output) as base64 for
# transfer to the machine that holds the git repo. Development happens in the
# cloud container because that is where the toolchain runs; the repo lives on
# the developer's machine.
set -euo pipefail
cd /root/cm
tar --exclude=node_modules --exclude=.next --exclude='*.tgz' -czf /tmp/cm-out.tgz "$@"
base64 -w0 /tmp/cm-out.tgz > /tmp/cm-out.b64
wc -c /tmp/cm-out.b64
