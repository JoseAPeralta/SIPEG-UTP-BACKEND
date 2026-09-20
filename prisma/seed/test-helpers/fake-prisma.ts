type Row = Record<string, unknown>;

interface WriteCounters {
  creates: number;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value);

const valuesEqual = (actual: unknown, expected: unknown): boolean => {
  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();
  }
  return actual === expected;
};

const matches = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([key, value]) => {
    if (isPlainObject(value)) {
      return Object.entries(value).every(([field, expected]) => valuesEqual(row[field], expected));
    }
    return valuesEqual(row[key], value);
  });

export class FakeModel {
  readonly rows: Row[] = [];

  constructor(
    private readonly name: string,
    private readonly counters: WriteCounters,
  ) {}

  private find(where?: Row): Row | undefined {
    if (!where) {
      return this.rows[0];
    }
    return this.rows.find((row) => matches(row, where));
  }

  async findUnique({ where }: { where: Row }): Promise<Row | null> {
    return this.find(where) ?? null;
  }

  async findFirst({ where }: { where?: Row } = {}): Promise<Row | null> {
    return this.find(where) ?? null;
  }

  async create({ data }: { data: Row }): Promise<Row> {
    this.counters.creates += 1;
    const row = { ...data };
    this.rows.push(row);
    return row;
  }

  async update({ where, data }: { where: Row; data: Row }): Promise<Row> {
    const row = this.find(where);
    if (!row) {
      throw new Error(`Fake Prisma: ${this.name} row not found for update.`);
    }
    Object.assign(row, data);
    return row;
  }

  async upsert({ where, update, create }: { where: Row; update: Row; create: Row }): Promise<Row> {
    const row = this.find(where);
    if (row) {
      Object.assign(row, update);
      return row;
    }
    this.counters.creates += 1;
    const created = { ...create };
    this.rows.push(created);
    return created;
  }

  async deleteMany({ where }: { where?: Row } = {}): Promise<{ count: number }> {
    const kept = this.rows.filter((row) => (where ? !matches(row, where) : false));
    const removed = this.rows.length - kept.length;
    this.rows.length = 0;
    this.rows.push(...kept);
    return { count: removed };
  }

  async createMany({
    data,
    skipDuplicates,
  }: {
    data: Row[];
    skipDuplicates?: boolean;
  }): Promise<{ count: number }> {
    let count = 0;
    for (const item of data) {
      if (skipDuplicates && this.rows.some((row) => matches(row, item))) {
        continue;
      }
      this.counters.creates += 1;
      this.rows.push({ ...item });
      count += 1;
    }
    return { count };
  }

  async count({ where }: { where?: Row } = {}): Promise<number> {
    return this.rows.filter((row) => (where ? matches(row, where) : true)).length;
  }
}

export interface FakePrismaClient {
  permission: FakeModel;
  organizationalUnit: FakeModel;
  career: FakeModel;
  classroom: FakeModel;
  classroomAmenity: FakeModel;
  classroomAvailability: FakeModel;
  eventProgram: FakeModel;
  user: FakeModel;
  account: FakeModel;
}

export const createFakePrisma = (): { client: FakePrismaClient; counters: WriteCounters } => {
  const counters: WriteCounters = { creates: 0 };
  const model = (name: string): FakeModel => new FakeModel(name, counters);

  return {
    client: {
      permission: model('permission'),
      organizationalUnit: model('organizationalUnit'),
      career: model('career'),
      classroom: model('classroom'),
      classroomAmenity: model('classroomAmenity'),
      classroomAvailability: model('classroomAvailability'),
      eventProgram: model('eventProgram'),
      user: model('user'),
      account: model('account'),
    },
    counters,
  };
};
