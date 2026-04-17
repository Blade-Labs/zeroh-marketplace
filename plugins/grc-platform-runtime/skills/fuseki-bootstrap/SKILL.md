---
name: fuseki-bootstrap
description: Plan or execute the Jena Fuseki/TDB2 runtime bootstrap, dataset layout, query/update boundaries, and local developer workflow.
argument-hint: "[task]"
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash Write Edit
---
Use the configured endpoints where relevant:

- Query endpoint: ${user_config.fuseki_query_endpoint}
- Update endpoint: ${user_config.fuseki_update_endpoint}
- Dataset: ${user_config.fuseki_dataset_name}

Keep strict separation between:
- query use
- reviewed update/migration use
- destructive maintenance

Prefer explicit scripts and reproducible local commands.
