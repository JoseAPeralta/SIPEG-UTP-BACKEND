import { requireAuthenticatedUser } from '../../middlewares/authenticate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import type { ListMyCertificatesQuery } from './certificates.schemas.js';
import { listMyCertificates as listMyCertificatesService } from './certificates.service.js';

export const listMyCertificates = asyncHandler(async (req, res) => {
  const user = requireAuthenticatedUser(req);
  const query = req.query as unknown as ListMyCertificatesQuery;
  const result = await listMyCertificatesService(user.id, query);

  res.status(200).json(successResponse('Certificates retrieved successfully.', result));
});
