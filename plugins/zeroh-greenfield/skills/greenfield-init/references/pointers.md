## Tool gate
If zeroh-roadmap is absent, print `/plugin install zeroh-roadmap@zeroh-marketplace` and STOP.

## Config branch
If roadmap config is absent, run `roadmap init`; if present, never run init. In both branches MERGE only missing keys and preserve every existing key.

## Merge manifest pointers
Copy only the selected manifest values into `designHomes.architecture.home`, `designHomes.architecture.extendProtocol`, `designHomes.ux.canon`, `designHomes.ux.qualityExemplar`, `designHomes.ux.copyRules`, `designHomes.ux.bindingDesignSystem`, and `testConventions`.
Map commands to `gateCommands.lint`, `gateCommands.types`, `gateCommands.unit`, `gateCommands.integration`, `gateCommands.build`, `gateCommands.e2e`, and `gateCommands.emit`.

### web
| slot | command | source |
| --- | --- | --- |
| lint | placeholder lint | placeholder |
| types | placeholder types | placeholder |
| unit | placeholder unit | placeholder |
| integration | placeholder integration | placeholder |
| build | placeholder build | placeholder |
| e2e | placeholder e2e | placeholder |
| emit | placeholder emit | placeholder |

### flutter
| slot | command | source |
| --- | --- | --- |
| lint | placeholder lint | placeholder |
| types | placeholder types | placeholder |
| unit | placeholder unit | placeholder |
| integration | placeholder integration | placeholder |
| build | placeholder build | placeholder |
| e2e | placeholder e2e | placeholder |
| emit | placeholder emit | placeholder |

### android
| slot | command | source |
| --- | --- | --- |
| lint | placeholder lint | placeholder |
| types | placeholder types | placeholder |
| unit | placeholder unit | placeholder |
| integration | placeholder integration | placeholder |
| build | placeholder build | placeholder |
| e2e | placeholder e2e | placeholder |
| emit | placeholder emit | placeholder |

### expo
| slot | command | source |
| --- | --- | --- |
| lint | placeholder lint | placeholder |
| types | placeholder types | placeholder |
| unit | placeholder unit | placeholder |
| integration | placeholder integration | placeholder |
| build | placeholder build | placeholder |
| e2e | placeholder e2e | placeholder |
| emit | placeholder emit | placeholder |

### nx-monorepo
| slot | command | source |
| --- | --- | --- |
| lint | placeholder lint | placeholder |
| types | placeholder types | placeholder |
| unit | placeholder unit | placeholder |
| integration | placeholder integration | placeholder |
| build | placeholder build | placeholder |
| e2e | placeholder e2e | placeholder |
| emit | placeholder emit | placeholder |

### library-cli
| slot | command | source |
| --- | --- | --- |
| lint | placeholder lint | placeholder |
| types | placeholder types | placeholder |
| unit | placeholder unit | placeholder |
| integration | placeholder integration | placeholder |
| build | placeholder build | placeholder |
| e2e | placeholder e2e | placeholder |
| emit | placeholder emit | placeholder |

## Validate
Run `roadmap config check` after either branch and STOP on red.
