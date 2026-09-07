# Pinned local artifact acquisition

`ht_tibetan.acquisition` reads the selected candidate and exact revision from `models.lock.json`. It acquires public files into:

```text
HT_ML_ROOT/models/<candidate_id>/<40-character revision>/tokenizer/
HT_ML_ROOT/models/<candidate_id>/<40-character revision>/model/
```

The root must be outside the Desktop checkout. No model library is imported and no repository code is executed by acquisition or verification. Acquiring files establishes artifact identity; it does not establish Tibetan ability, medical safety, model loading compatibility, or upstream conversion provenance.

## Selections

The default is **tokenizer only**. It selects model configuration, tokenizer JSON/model/vocabulary/merges, tokenizer configuration, special/added tokens, chat template JSON/Jinja, and available README/license/notice files. Explicit `include_weights=True` additionally includes safetensors, their indexes and processor/preprocessor configuration. Python source, pickle/checkpoint payloads and archives are not selected. Files are copied byte-for-byte; an inconsistent publisher index is preserved and remains a compatibility issue for the later runtime check.

Every inventory path, revision, size and available hash is validated before writing or transferring. Selection requires a root `config.json`, `tokenizer_config.json`, and tokenizer payload. Model mode also requires safetensors weights. Duplicate/case-colliding paths, traversal, reserved local receipt paths, malformed hashes and unknown sizes are errors.

## Verification and receipts

For each selected file:

- The local byte count must equal the pinned inventory's size.
- An LFS file's payload SHA-256 must match `lfs_sha256`. Its catalogued `git_blob_sha1` describes an LFS pointer and is not compared with the downloaded payload.
- A non-LFS file's Git blob SHA-1 is computed over `blob <size>\0` plus the bytes and must match the lock.
- Any previously measured `content_sha256` in the lock must also match.

The local `acquisition.receipt.json` records measured payload sizes, SHA-256 and Git blob SHA-1, the selection identity, exact source-lock hash at acquisition, and the starting storage calculation. The measured Git blob hash always describes the local payload, even when the repository stores that payload through LFS. The receipt never claims that the publisher's LFS pointer was downloaded or locally verified.

An existing snapshot is reused only after its entire file inventory, all payloads and its complete receipt verify again. Extra files, symlinks, hard-linked payloads, unexpected directories, missing files, altered hashes or an inconsistent receipt are errors. Existing destinations are never silently repaired or overwritten.

## Transfer and storage bounds

The initial URL is a public HTTPS Hugging Face `resolve/<pinned revision>/<path>` URL. Redirects are limited to HTTPS Hugging Face delivery domains, without URL credentials or nonstandard ports. No Hugging Face SDK, credential store, `.netrc`, environment proxy or authorization header is used. A gated/inaccessible file fails without accepting terms or trying a different source.

Transfers use available-byte reads of at most one MiB, a socket timeout capped at 30 seconds, a 30-minute body-transfer deadline per file, a two-hour body-transfer deadline per snapshot, exact declared file sizes and redirect limits. The deadline starts before opening each request, is checked before and after every `read1`, and reduces the socket timeout to the remaining time. Expired bytes are rejected even if they complete a file. Unsupported response/socket wrappers and chunked transfer framing fail closed; the reader never falls back to a filling `read`. Initial connection, redirects and HTTP header parsing use the socket timeout; DNS and header handling do not have a separate hard process-level wall-clock supervisor. Downloaded data stays in one private, unique staging directory. Storage accounting includes the selected payload plus the larger of 64 MiB or 5% scratch/filesystem headroom, leaving a default 15 GiB free-space reserve. Free space is checked before transfer, during every chunk, and before publication. Existing models/environments are already reflected in measured free space. Future conversions, training checkpoints and external caches need their own additional storage budget.

The complete staging snapshot is independently read and verified, then published with an OS-enforced atomic no-overwrite rename. Darwin uses `renamex_np(RENAME_EXCL)` and Linux uses `renameat2(RENAME_NOREPLACE)`; unsupported platforms fail instead of falling back to an overwrite-capable operation. Normal exceptions and interrupts clean only the operation's own staging directory. A process kill or power loss can leave an unpublished staging directory; it is never interpreted as a completed snapshot or automatically removed by a later acquisition.

## Offline tests and injected transports

The public Python functions are:

```python
acquire_snapshot(lock_path, candidate_id, root, *,
                 include_weights=False, reserve_bytes=DEFAULT_RESERVE,
                 downloader=None, free_bytes=None)
verify_snapshot(lock_path, candidate_id, snapshot_dir, *, include_weights=False)
```

For offline tests, `downloader(url, file_spec)` yields nonempty byte chunks no larger than one MiB, and `free_bytes(path)` returns a nonnegative integer. Test fixture bytes are explicitly synthetic and provide no language or model-quality evidence. Normal callers omit both injections. Verification never makes network requests.
