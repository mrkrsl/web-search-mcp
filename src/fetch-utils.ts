type FetchTextOptions = {
  headers?: Record<string, string>;
  maxContentLength?: number;
  params?: Record<string, string>;
  signal?: AbortSignal;
  timeout: number;
};

type FetchErrorOptions = {
  body?: string;
  cause?: unknown;
  code?: string;
  status?: number;
  statusText?: string;
};

export class FetchError extends Error {
  body?: string;
  code?: string;
  status?: number;
  statusText?: string;

  constructor(message: string, options: FetchErrorOptions = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'FetchError';
    this.body = options.body;
    this.code = options.code;
    this.status = options.status;
    this.statusText = options.statusText;
  }
}

export function isFetchError(error: unknown): error is FetchError {
  return error instanceof FetchError;
}

export async function fetchText(url: string, options: FetchTextOptions): Promise<{ data: string; status: number; statusText: string }> {
  const targetUrl = new URL(url);

  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      targetUrl.searchParams.set(key, value);
    }
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeout);
  const abortHandler = () => controller.abort(options.signal?.reason);

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort(options.signal.reason);
    } else {
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }
  }

  try {
    const response = await fetch(targetUrl, {
      headers: options.headers,
      redirect: 'follow',
      signal: controller.signal,
    });
    const data = await response.text();

    if (!response.ok) {
      throw new FetchError(`Request failed with status ${response.status}`, {
        body: data,
        status: response.status,
        statusText: response.statusText,
      });
    }

    if (options.maxContentLength && data.length > options.maxContentLength) {
      throw new FetchError('maxContentLength exceeded', {
        code: 'MAX_CONTENT_LENGTH_EXCEEDED',
        status: response.status,
        statusText: response.statusText,
      });
    }

    return {
      data,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error) {
    if (error instanceof FetchError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      if (timedOut) {
        throw new FetchError('Request timeout', {
          cause: error,
          code: 'ECONNABORTED',
        });
      }
      if (options.signal?.aborted) {
        throw new FetchError('Request aborted', {
          cause: error,
          code: 'ECANCELED',
        });
      }
      throw new FetchError('Request timeout', {
        cause: error,
        code: 'ECONNABORTED',
      });
    }
    throw new FetchError(error instanceof Error ? error.message : 'Network error', {
      cause: error,
    });
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', abortHandler);
  }
}
