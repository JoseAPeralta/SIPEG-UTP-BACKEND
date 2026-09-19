import type { RequestHandler } from 'express';

import type { EventResponse } from '../models/event.model.js';
import { successResponse } from '../utils/response.js';

const fakeEvents: EventResponse[] = [
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
];

export const getEvents: RequestHandler = (_req, res) => {
  res.status(200).json(successResponse('Events retrieved successfully.', fakeEvents));
};
