export function resolveMetaK2CloudflarePagination(input = {}) {
  const requestedPage = Number(input.requestedPage);
  const requestedPageSize = Number(input.requestedPageSize ?? 100);
  const maxPages = Number(input.maxPages ?? 20);
  const resultCount = Number(input.resultCount);
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1
    || !Number.isSafeInteger(requestedPageSize) || requestedPageSize < 1
    || !Number.isSafeInteger(maxPages) || maxPages < 1
    || !Number.isSafeInteger(resultCount) || resultCount < 0
    || resultCount > requestedPageSize) {
    throw invalidPagination();
  }

  const info = input.resultInfo;
  if (info === undefined || info === null) {
    if (resultCount === requestedPageSize) throw invalidPagination();
    return Object.freeze({ totalPages: requestedPage, metadataPresent: false });
  }
  if (typeof info !== 'object' || Array.isArray(info)) throw invalidPagination();

  const page = optionalInteger(info.page, false);
  if (page !== null && page !== requestedPage) throw invalidPagination();
  const count = optionalInteger(info.count, true);
  if (count !== null && count !== resultCount) throw invalidPagination();
  const perPage = optionalInteger(info.per_page, false) ?? requestedPageSize;
  const totalCount = optionalInteger(info.total_count, true);
  let totalPages = optionalInteger(info.total_pages, true);

  if (totalPages === null && totalCount !== null) {
    totalPages = Math.ceil(totalCount / perPage);
  }
  if (totalPages === null) {
    if (resultCount >= perPage) throw invalidPagination();
    totalPages = requestedPage;
  }
  if (totalPages === 0) {
    if (requestedPage !== 1 || resultCount !== 0
      || (totalCount !== null && totalCount !== 0)) throw invalidPagination();
    return Object.freeze({ totalPages: 0, metadataPresent: true });
  }
  if (totalPages < requestedPage || totalPages > maxPages) throw invalidPagination();
  if (totalCount !== null && Math.ceil(totalCount / perPage) !== totalPages) {
    throw invalidPagination();
  }
  return Object.freeze({ totalPages, metadataPresent: true });
}

function optionalInteger(value, allowZero) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(number) || number < minimum) throw invalidPagination();
  return number;
}

function invalidPagination() {
  const error = new Error('Cloudflare ingress pagination metadata is invalid');
  error.code = 'META_K2_CLOUDFLARE_RECOVERY_RESPONSE_INVALID';
  return error;
}
