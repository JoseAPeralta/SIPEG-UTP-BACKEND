import { afterEach, describe, expect, it, vi } from 'vitest';

interface SchedulePrismaMock {
  classroom: { findUnique: ReturnType<typeof vi.fn> };
  classroomAvailability: { findFirst: ReturnType<typeof vi.fn> };
  activity: { findFirst: ReturnType<typeof vi.fn> };
}

const createSchedulePrismaMock = (): SchedulePrismaMock => ({
  classroom: { findUnique: vi.fn() },
  classroomAvailability: { findFirst: vi.fn() },
  activity: { findFirst: vi.fn() },
});

const loadSchedule = async (prisma: SchedulePrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({
    getPrismaClient: () => prisma,
  }));

  return import('./activities.schedule.js');
};

const START = new Date('1970-01-01T14:00:00.000Z');
const END = new Date('1970-01-01T17:00:00.000Z');
const DATE = new Date('2026-10-05T00:00:00.000Z');

const scheduleInput = {
  activityId: 'activity-001',
  classroomId: 'classroom-001',
  date: DATE,
  startTime: START,
  endTime: END,
  maxCapacity: 35,
};

const activeClassroom = { id: 'classroom-001', isActive: true, capacity: 60 };

describe('assertActivityTimeRange', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('accepts an end time after the start time', async () => {
    const { assertActivityTimeRange } = await loadSchedule(createSchedulePrismaMock());

    expect(() => assertActivityTimeRange(START, END)).not.toThrow();
  });

  it('rejects an end time equal to or before the start time', async () => {
    const { assertActivityTimeRange } = await loadSchedule(createSchedulePrismaMock());

    expect(() => assertActivityTimeRange(END, START)).toThrow('End time must be after start time.');
    expect(() => assertActivityTimeRange(START, START)).toThrow(
      'End time must be after start time.',
    );
  });
});

describe('assertClassroomIsAssignable', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('resolves for an active classroom', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue(activeClassroom);
    const { assertClassroomIsAssignable } = await loadSchedule(prisma);

    await expect(assertClassroomIsAssignable('classroom-001')).resolves.toBeUndefined();
    expect(prisma.classroom.findUnique).toHaveBeenCalledWith({
      where: { id: 'classroom-001' },
      select: { id: true, isActive: true, capacity: true },
    });
  });

  it('rejects a missing classroom with 404', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue(null);
    const { assertClassroomIsAssignable } = await loadSchedule(prisma);

    await expect(assertClassroomIsAssignable('classroom-missing')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Classroom not found.',
    });
  });

  it('rejects an inactive classroom with 400', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue({ ...activeClassroom, isActive: false });
    const { assertClassroomIsAssignable } = await loadSchedule(prisma);

    await expect(assertClassroomIsAssignable('classroom-001')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Classroom is not active.',
    });
  });
});

describe('assertActivityScheduleIsAvailable', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('resolves when the classroom covers the schedule without overlaps', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue(activeClassroom);
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue(null);
    const { assertActivityScheduleIsAvailable } = await loadSchedule(prisma);

    await expect(assertActivityScheduleIsAvailable(scheduleInput)).resolves.toBeUndefined();

    expect(prisma.classroomAvailability.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          classroomId: 'classroom-001',
          dayOfWeek: 1,
          startTime: { lte: START },
          endTime: { gte: END },
        },
      }),
    );
    expect(prisma.activity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { not: 'activity-001' },
          classroomId: 'classroom-001',
          date: DATE,
          status: { in: ['SCHEDULED', 'ONGOING'] },
          startTime: { lt: END },
          endTime: { gt: START },
        },
      }),
    );
  });

  it('checks availability without excluding any activity when creating', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue(activeClassroom);
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue(null);
    const { assertActivityScheduleIsAvailable } = await loadSchedule(prisma);

    await expect(
      assertActivityScheduleIsAvailable({
        classroomId: scheduleInput.classroomId,
        date: scheduleInput.date,
        startTime: scheduleInput.startTime,
        endTime: scheduleInput.endTime,
        maxCapacity: scheduleInput.maxCapacity,
      }),
    ).resolves.toBeUndefined();

    const where = (prisma.activity.findFirst.mock.calls[0]?.[0] as { where: object }).where;
    expect(where).not.toHaveProperty('id');
  });

  it('rejects a missing classroom with 404 before any availability query', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue(null);
    const { assertActivityScheduleIsAvailable } = await loadSchedule(prisma);

    await expect(assertActivityScheduleIsAvailable(scheduleInput)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Classroom not found.',
    });
    expect(prisma.classroomAvailability.findFirst).not.toHaveBeenCalled();
    expect(prisma.activity.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an inactive classroom with 400', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue({ ...activeClassroom, isActive: false });
    const { assertActivityScheduleIsAvailable } = await loadSchedule(prisma);

    await expect(assertActivityScheduleIsAvailable(scheduleInput)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Classroom is not active.',
    });
    expect(prisma.classroomAvailability.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a classroom with less capacity than the activity', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue({ ...activeClassroom, capacity: 20 });
    const { assertActivityScheduleIsAvailable } = await loadSchedule(prisma);

    await expect(assertActivityScheduleIsAvailable(scheduleInput)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Classroom capacity is below the activity capacity.',
    });
    expect(prisma.classroomAvailability.findFirst).not.toHaveBeenCalled();
  });

  it('skips the capacity check when the activity has no capacity', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue({ ...activeClassroom, capacity: 1 });
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue(null);
    const { assertActivityScheduleIsAvailable } = await loadSchedule(prisma);

    await expect(
      assertActivityScheduleIsAvailable({ ...scheduleInput, maxCapacity: null }),
    ).resolves.toBeUndefined();
  });

  it('rejects a schedule outside the classroom availability windows with 409', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue(activeClassroom);
    prisma.classroomAvailability.findFirst.mockResolvedValue(null);
    const { assertActivityScheduleIsAvailable } = await loadSchedule(prisma);

    await expect(assertActivityScheduleIsAvailable(scheduleInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Classroom is not available in the requested time window.',
    });
    expect(prisma.activity.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an overlapping reservation with 409', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue(activeClassroom);
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue({ id: 'activity-999' });
    const { assertActivityScheduleIsAvailable } = await loadSchedule(prisma);

    await expect(assertActivityScheduleIsAvailable(scheduleInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Classroom is already reserved for an overlapping activity.',
    });
  });
});

describe('isExclusionViolation', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('detects the classroom exclusion constraint through code, meta or message', async () => {
    const { isExclusionViolation } = await loadSchedule(createSchedulePrismaMock());

    expect(isExclusionViolation({ code: '23P01' })).toBe(true);
    expect(isExclusionViolation({ meta: { code: '23P01' } })).toBe(true);
    expect(
      isExclusionViolation({
        message:
          'conflicting key value violates exclusion constraint "activities_classroom_no_overlap"',
      }),
    ).toBe(true);
  });

  it('ignores unrelated errors', async () => {
    const { isExclusionViolation } = await loadSchedule(createSchedulePrismaMock());

    expect(isExclusionViolation(null)).toBe(false);
    expect(isExclusionViolation('boom')).toBe(false);
    expect(isExclusionViolation({ code: 'P2002' })).toBe(false);
  });
});
