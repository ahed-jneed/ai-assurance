"""Resource limits for hostile inputs (design section 11.3).

The memory and CPU values were measured at design time on CPython 3.11
(Windows, tracemalloc); `engine/GENAI.md` records the re-measurement plan for
the compute image. Change a constant only together with that record.
"""

MiB = 1024 * 1024

MAX_INPUT_FILE_BYTES = 50 * MiB
MAX_BUNDLE_FILES = 64
MAX_BUNDLE_BYTES = 200 * MiB
MAX_DECOMPRESSED_BYTES = 512 * MiB
MAX_ENTRY_BYTES = 64 * MiB
MAX_ZIP_ENTRIES = 50_000
MAX_ENTRY_RATIO = 500
RATIO_CHECK_ABOVE = 1 * MiB
MAX_ZIP_NAME_BYTES = 512
MAX_JSONL_LINE_BYTES = 16 * MiB
MAX_JSON_DEPTH = 64
MAX_OBJECT_KEYS = 10_000
MAX_STRING_BYTES = 16 * MiB
MAX_ITEMS = 50_000
MAX_SCORES_PER_ITEM = 50
MAX_LABELS = 50
MAX_LABEL_CHARS = 500
MAX_INLINE_ITEMS_BYTES = 4 * MiB
MAX_RESULT_BYTES = 8 * MiB
MAX_COMPLETION_BYTES = 10 * MiB
COMPLETION_OVERHEAD_BYTES = 4096
MAX_EXCERPT_CHARS = 1000
MAX_PLAN_BYTES = 1 * MiB
MAX_MANIFEST_BYTES = 1 * MiB
