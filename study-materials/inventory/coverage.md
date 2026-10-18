# PESU bucket source inventory

Inventory date: 2026-10-18 UTC  
Bucket: `alvin3y10/data`  
Total: 2,437 files (21.39 GiB); 215 videos (19.26 GiB).

## Current course corpus

| Course | Files | Videos | Units | Source coverage |
|---|---:|---:|---|---|
| UC26CE121A CONSTITUTIONAL LAW CYBER LAW IP LAW AND PROFESSIONAL ETHICS | 67 | 0 | Unit_01 (0 videos), Unit_02 (0 videos) | .md: 23, .pdf: 4, .pptx: 18, .txt: 22 |
| UE26CS151A Python for computational Problem Solving | 366 | 41 | Unit_01 (21 videos), Unit_02 (4 videos), Unit_03 (11 videos), Unit_04 (5 videos) | .json: 41, .md: 96, .mp4: 41, .pdf: 49, .pptx: 4, .srt: 41, .txt: 94 |
| UE26CY151A Engineering Chemistry | 398 | 50 | Unit_01 (14 videos), Unit_02 (14 videos), Unit_03 (10 videos), Unit_04 (12 videos) | .json: 50, .md: 100, .mp4: 50, .pdf: 1, .ppt: 1, .pptx: 47, .srt: 50, .txt: 99 |
| UE26EC141A Electronic Principles and Devices | 96 | 11 | Unit_01 (11 videos) | .json: 11, .md: 26, .mp4: 11, .pdf: 13, .srt: 11, .txt: 24 |
| UE26MA141A Engineering Mathematics - I | 484 | 58 | Unit_01 (17 videos), Unit_02 (16 videos), Unit_03 (13 videos), Unit_04 (6 videos), Unit_05 (6 videos) | .json: 58, .md: 124, .mp4: 58, .pdf: 22, .pptx: 42, .srt: 58, .txt: 122 |
| UE26ME142A Engineering Mechanics 1 | 509 | 55 | Unit_01 (16 videos), Unit_02 (15 videos), Unit_03 (12 videos), Unit_04 (12 videos) | .json: 55, .md: 120, .mp4: 55, .pdf: 63, .ppt: 43, .srt: 55, .txt: 118 |

## Video sidecar checks

| Subject | Unit | Videos | JSON | Markdown | SRT | Plain text |
|---|---|---:|---:|---:|---:|---:|
| UC26CE121A CONSTITUTIONAL LAW CYBER LAW IP LAW AND PROFESSIONAL ETHICS | Unit_01 | 0 | 0 | 0 | 0 | 0 |
| UC26CE121A CONSTITUTIONAL LAW CYBER LAW IP LAW AND PROFESSIONAL ETHICS | Unit_02 | 0 | 0 | 0 | 0 | 0 |
| UE26CS151A Python for computational Problem Solving | Unit_01 | 21 | 21 | 21 | 21 | 21 |
| UE26CS151A Python for computational Problem Solving | Unit_02 | 4 | 4 | 4 | 4 | 4 |
| UE26CS151A Python for computational Problem Solving | Unit_03 | 11 | 11 | 11 | 11 | 11 |
| UE26CS151A Python for computational Problem Solving | Unit_04 | 5 | 5 | 5 | 5 | 5 |
| UE26CY151A Engineering Chemistry | Unit_01 | 14 | 14 | 14 | 14 | 14 |
| UE26CY151A Engineering Chemistry | Unit_02 | 14 | 14 | 14 | 14 | 14 |
| UE26CY151A Engineering Chemistry | Unit_03 | 10 | 10 | 10 | 10 | 10 |
| UE26CY151A Engineering Chemistry | Unit_04 | 12 | 12 | 12 | 12 | 12 |
| UE26EC141A Electronic Principles and Devices | Unit_01 | 11 | 11 | 11 | 11 | 11 |
| UE26MA141A Engineering Mathematics - I | Unit_01 | 17 | 17 | 17 | 17 | 17 |
| UE26MA141A Engineering Mathematics - I | Unit_02 | 16 | 16 | 16 | 16 | 16 |
| UE26MA141A Engineering Mathematics - I | Unit_03 | 13 | 13 | 13 | 13 | 13 |
| UE26MA141A Engineering Mathematics - I | Unit_04 | 6 | 6 | 6 | 6 | 6 |
| UE26MA141A Engineering Mathematics - I | Unit_05 | 6 | 6 | 6 | 6 | 6 |
| UE26ME142A Engineering Mechanics 1 | Unit_01 | 16 | 16 | 16 | 16 | 16 |
| UE26ME142A Engineering Mechanics 1 | Unit_02 | 15 | 15 | 15 | 15 | 15 |
| UE26ME142A Engineering Mechanics 1 | Unit_03 | 12 | 12 | 12 | 12 | 12 |
| UE26ME142A Engineering Mechanics 1 | Unit_04 | 12 | 12 | 12 | 12 | 12 |

## Scope notes

- The current course corpus contains six subjects. Five have lecture videos; the Constitutional Law course has no MP4 files in the bucket.
- `First_Year_8enterprise/` has 502 files and no videos. It is inventoried but is an older resource archive, not part of the video corpus.
- Video sidecar availability is checked file by file in `source-inventory.json`; missing sidecars remain explicit gaps.
- Source URLs, sizes and Hugging Face Xet hashes are preserved in the machine-readable inventory.
- The 19.26 GiB video originals stay hosted in the bucket; the generated repository contains the study products and reproducible source manifests.
