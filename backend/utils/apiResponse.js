const apiResponse = {
  success: (res, data = {}, message = 'Success', statusCode = 200) => {
    // If data is an object, we can spread it or include standard success wrapper
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      return res.status(statusCode).json({
        success: true,
        message,
        ...data
      });
    }
    return res.status(statusCode).json({
      success: true,
      message,
      data
    });
  },

  error: (res, message = 'Internal Server Error', statusCode = 500, errors = null) => {
    const payload = {
      success: false,
      message
    };
    if (errors) {
      payload.errors = errors;
    }
    return res.status(statusCode).json(payload);
  }
};

module.exports = apiResponse;
