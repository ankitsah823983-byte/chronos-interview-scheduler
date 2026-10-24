const pool = require("./db");

// Verify the session and reload the user's current status and role
// from PostgreSQL on every protected request.
async function requireAuth(req, res, next) {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: "Authentication required.",
    });
  }

  try {
    const result = await pool.query(
      `SELECT
         user_id AS "userId",
         full_name AS "fullName",
         email,
         role,
         candidate_id AS "candidateId",
         interviewer_id AS "interviewerId",
         is_active AS "isActive"
       FROM user_accounts
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rowCount === 0 || !result.rows[0].isActive) {
      req.session.destroy((error) => {
        if (error) {
          console.error(
            "Failed to destroy inactive user session:",
            error.message
          );
        }
      });

      return res.status(401).json({
        success: false,
        error: "Your session is no longer valid. Please log in again.",
      });
    }

    const user = result.rows[0];

    req.user = {
      userId: user.userId,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      candidateId: user.candidateId,
      interviewerId: user.interviewerId,
    };

    return next();
  } catch (error) {
    console.error("Authentication verification failed:", error.message);

    return res.status(500).json({
      success: false,
      error: "Could not verify your account permissions.",
    });
  }
}

// Always combine this with requireAuth on protected routes.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Authentication required.",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: "You do not have permission to perform this action.",
      });
    }

    return next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
};