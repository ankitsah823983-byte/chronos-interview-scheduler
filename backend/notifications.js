const express = require("express");
const pool = require("./db");

const router = express.Router();

// GET /api/notifications
// The authenticated user's identity comes from the server session.
router.get("/", async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT
         notification_id AS "notificationId",
         event_id AS "eventId",
         notification_type AS type,
         title,
         message,
         read_at AS "readAt",
         created_at AS "createdAt"
       FROM user_notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId]
    );

    const unreadResult = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM user_notifications
       WHERE user_id = $1
         AND read_at IS NULL`,
      [userId]
    );

    return res.json({
      success: true,
      notifications: result.rows,
      unreadCount: unreadResult.rows[0].count,
    });
  } catch (error) {
    console.error("Failed to load notifications:", error.message);

    return res.status(500).json({
      success: false,
      error: "Could not load notifications.",
    });
  }
});

// PATCH /api/notifications/read-all
router.patch("/read-all", async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE user_notifications
       SET read_at = now()
       WHERE user_id = $1
         AND read_at IS NULL`,
      [req.user.userId]
    );

    return res.json({
      success: true,
      updatedCount: result.rowCount,
    });
  } catch (error) {
    console.error("Failed to mark notifications read:", error.message);

    return res.status(500).json({
      success: false,
      error: "Could not mark notifications as read.",
    });
  }
});

// PATCH /api/notifications/:notificationId/read
router.patch("/:notificationId/read", async (req, res) => {
  const { notificationId } = req.params;

  if (
    typeof notificationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      notificationId
    )
  ) {
    return res.status(400).json({
      success: false,
      error: "Notification ID must be a valid UUID.",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE user_notifications
       SET read_at = COALESCE(read_at, now())
       WHERE notification_id = $1
         AND user_id = $2
       RETURNING notification_id AS "notificationId",
                 read_at AS "readAt"`,
      [notificationId, req.user.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: "Notification not found.",
      });
    }

    return res.json({
      success: true,
      notification: result.rows[0],
    });
  } catch (error) {
    console.error("Failed to mark notification read:", error.message);

    return res.status(500).json({
      success: false,
      error: "Could not mark notification as read.",
    });
  }
});

module.exports = router;
