from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'Expected one anchor in {path}, found {count}: {old[:100]!r}')
    write(path, text.replace(old, new, 1))

# QueueService full-suite mock must expose the new Prisma delegate because interactive
# transactions deliberately execute against this same object.
replace_once(
    'apps/backend/src/queue/queue.service.spec.ts',
    "  chair: {\n    findFirst: jest.Mock<Promise<unknown>, [unknown]>;\n    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;\n    count: jest.Mock<Promise<number>, [unknown]>;\n  };\n",
    "  chair: {\n    findFirst: jest.Mock<Promise<unknown>, [unknown]>;\n    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;\n    count: jest.Mock<Promise<number>, [unknown]>;\n  };\n  manualChairOccupancy: {\n    findFirst: jest.Mock<Promise<unknown>, [unknown]>;\n    findMany: jest.Mock<Promise<unknown[]>, [unknown]>;\n    count: jest.Mock<Promise<number>, [unknown]>;\n  };\n",
)
replace_once(
    'apps/backend/src/queue/queue.service.spec.ts',
    "      chair: {\n        findFirst: jest.fn<Promise<unknown>, [unknown]>(),\n        findMany: jest\n          .fn<Promise<unknown[]>, [unknown]>()\n          .mockResolvedValue([]),\n        count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(4),\n      },\n",
    "      chair: {\n        findFirst: jest.fn<Promise<unknown>, [unknown]>(),\n        findMany: jest\n          .fn<Promise<unknown[]>, [unknown]>()\n          .mockResolvedValue([]),\n        count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(4),\n      },\n      manualChairOccupancy: {\n        findFirst: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(null),\n        findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([]),\n        count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(0),\n      },\n",
)

# Unrelated stale test fixture maintenance: AuthenticatedUser has required session audience since
# the already-merged auth hardening. The controller behavior under test remains unchanged.
replace_once(
    'apps/backend/src/push-notifications/push-notifications.controller.spec.ts',
    "import { Test } from '@nestjs/testing';\n",
    "import { Test } from '@nestjs/testing';\nimport { SessionAudience, type AuthenticatedUser } from '@barbercue/shared';\n",
)
replace_once(
    'apps/backend/src/push-notifications/push-notifications.controller.spec.ts',
    "const USER = { id: 'u1', roles: [] } as { id: string; roles: [] };\n",
    "const USER: AuthenticatedUser = { id: 'u1', roles: [], audience: SessionAudience.CUSTOMER };\n",
)

print('Combined mission test mocks aligned successfully.')
