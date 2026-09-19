import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface ActivitiesServiceMock {
  listUpcomingActivities: ReturnType<typeof vi.fn>;
}

const buildServiceMock = (): ActivitiesServiceMock => ({
  listUpcomingActivities: vi.fn(),
});

const loadApp = async (service: ActivitiesServiceMock) => {
  vi.resetModules();
  vi.doMock('../modules/activities/activities.service.js', () => service);
  const { app } = await import('../app.js');
  return app;
};

const activityItem = {
  id: 'activity-001',
  name: 'Taller de Inteligencia Artificial',
  description: null,
  type: 'WORKSHOP',
  date: '2026-09-20',
  startTime: '14:00',
  endTime: '17:00',
  capacity: 35,
  bannerUrl: null,
  speaker: { id: 'user-001', firstName: 'Carlos', lastName: 'Rivera' },
  classroom: { id: 'classroom-001', name: 'Laboratorio 3', building: 'Edificio B' },
  eventProgram: { id: 'program-001', name: 'Programa de Ingenieria', label: null },
  organizationalUnit: {
    type: 'FACULTY',
    id: 'faculty-001',
    name: 'Ingenieria de Sistemas Computacionales',
  },
};

describe('activity routes', () => {
  afterEach(() => {
    vi.doUnmock('../modules/activities/activities.service.js');
  });

  it('returns paginated upcoming activities', async () => {
    const service = buildServiceMock();
    service.listUpcomingActivities.mockResolvedValue({
      items: [activityItem],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    const app = await loadApp(service);

    const response = await request(app).get('/api/v1/activities').expect(200);

    expect(response.body).toEqual({
      success: true,
      message: 'Activities retrieved successfully.',
      data: {
        items: [activityItem],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('applies default pagination when no query is provided', async () => {
    const service = buildServiceMock();
    service.listUpcomingActivities.mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
    const app = await loadApp(service);

    await request(app).get('/api/v1/activities').expect(200);

    expect(service.listUpcomingActivities).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  it('forwards parsed pagination parameters', async () => {
    const service = buildServiceMock();
    service.listUpcomingActivities.mockResolvedValue({
      items: [],
      page: 3,
      limit: 50,
      total: 0,
      totalPages: 0,
    });
    const app = await loadApp(service);

    await request(app).get('/api/v1/activities?page=3&limit=50').expect(200);

    expect(service.listUpcomingActivities).toHaveBeenCalledWith({ page: 3, limit: 50 });
  });

  it('rejects a limit above the maximum', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    const response = await request(app).get('/api/v1/activities?limit=100').expect(400);

    expect(response.body).toMatchObject({ success: false, message: 'Validation error.' });
    expect(service.listUpcomingActivities).not.toHaveBeenCalled();
  });

  it('rejects an invalid page', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app).get('/api/v1/activities?page=0').expect(400);
    expect(service.listUpcomingActivities).not.toHaveBeenCalled();
  });
});
