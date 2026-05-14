import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app } from '../app.js';

describe('event routes', () => {
  it('returns fake events', async () => {
    const response = await request(app).get('/api/v1/events').expect(200);

    expect(response.body).toEqual({
      success: true,
      message: 'Events retrieved successfully.',
      data: [
        {
          id: 'event-001',
          name: 'Congreso de Tecnologia UTP',
          type: 'conference',
          speaker: 'Dra. Ana Martinez',
          classroom: 'Auditorio Principal',
          date: '2026-06-15',
          startTime: '09:00',
          endTime: '12:00',
          capacity: 250,
          faculty: 'Ingenieria de Sistemas Computacionales',
        },
        {
          id: 'event-002',
          name: 'Taller de Inteligencia Artificial',
          type: 'workshop',
          speaker: 'Ing. Carlos Rivera',
          classroom: 'Laboratorio 3',
          date: '2026-06-18',
          startTime: '14:00',
          endTime: '17:00',
          capacity: 35,
          faculty: 'Ingenieria de Sistemas Computacionales',
        },
      ],
    });
  });
});
