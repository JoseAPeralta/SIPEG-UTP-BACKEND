import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface EventsServiceMock {
  listUpcomingEvents: ReturnType<typeof vi.fn>;
}

const buildServiceMock = (): EventsServiceMock => ({
  listUpcomingEvents: vi.fn(),
});

const loadApp = async (service: EventsServiceMock) => {
  vi.resetModules();
  vi.doMock('../modules/events/events.service.js', () => service);
  const { app } = await import('../app.js');
  return app;
};

const eventItem = {
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

describe('event routes', () => {
  afterEach(() => {
    vi.doUnmock('../modules/events/events.service.js');
  });

  it('returns paginated upcoming events', async () => {
    const service = buildServiceMock();
    service.listUpcomingEvents.mockResolvedValue({
      items: [eventItem],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    const app = await loadApp(service);

    const response = await request(app).get('/api/v1/events').expect(200);

    expect(response.body).toEqual({
      success: true,
      message: 'Events retrieved successfully.',
      data: {
        items: [eventItem],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('applies default pagination when no query is provided', async () => {
    const service = buildServiceMock();
    service.listUpcomingEvents.mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
    const app = await loadApp(service);

    await request(app).get('/api/v1/events').expect(200);

    expect(service.listUpcomingEvents).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  it('forwards parsed pagination parameters', async () => {
    const service = buildServiceMock();
    service.listUpcomingEvents.mockResolvedValue({
      items: [],
      page: 3,
      limit: 50,
      total: 0,
      totalPages: 0,
    });
    const app = await loadApp(service);

    await request(app).get('/api/v1/events?page=3&limit=50').expect(200);

    expect(service.listUpcomingEvents).toHaveBeenCalledWith({ page: 3, limit: 50 });
  });

  it('rejects a limit above the maximum', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    const response = await request(app).get('/api/v1/events?limit=100').expect(400);

    expect(response.body).toMatchObject({ success: false, message: 'Validation error.' });
    expect(service.listUpcomingEvents).not.toHaveBeenCalled();
  });

  it('rejects an invalid page', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app).get('/api/v1/events?page=0').expect(400);
    expect(service.listUpcomingEvents).not.toHaveBeenCalled();
  });
});
