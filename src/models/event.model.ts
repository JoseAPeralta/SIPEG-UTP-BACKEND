export interface EventResponse {
  id: string;
  name: string;
  type: 'conference' | 'workshop';
  speaker: string;
  classroom: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  faculty: string;
}
