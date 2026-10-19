import express, { type RequestHandler } from 'express';
import { DomainError } from '../domain/errors.js';

// Let services distinguish valid JSON with the wrong shape from malformed JSON.
const parseJson = express.json({
  strict: false,
  verify(_request, _response, buffer) {
    // Express otherwise turns an empty body into {}, but the contract requires JSON.
    if (buffer.length === 0) {
      throw new DomainError('INVALID_REQUEST', 'Body must be a JSON object');
    }
  },
});

export const jsonBody: RequestHandler = (request, response, next) => {
  const mediaType = request.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    next(new DomainError('UNSUPPORTED_MEDIA_TYPE', 'Request body must use application/json'));
    return;
  }
  parseJson(request, response, next);
};
