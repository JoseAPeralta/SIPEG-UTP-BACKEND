import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app } from '../app.js';

describe('health routes', () => {
  it('returns the service health status', async () => {
    const response = await request(app).get('/api/v1/health').expect(200);

    expect(response.body).toEqual({
      success: true,
      message: 'Service is healthy.',
      data: {
        status: 'ok',
        service: 'sipeg-utp-backend',
        environment: 'test',
      },
    });
  });
});
