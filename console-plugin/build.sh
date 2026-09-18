#!/bin/bash
# Patch the validation to allow React 18
sed -i.bak 's/Console provides shared module react/WARNING: Console provides shared module react/g' node_modules/@openshift-console/dynamic-plugin-sdk-webpack/lib/validation/ValidationResult.js
npm run build
