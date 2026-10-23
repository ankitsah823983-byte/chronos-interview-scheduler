const payload = {
  timeSlots: ["10:00", "10:30", "11:00", "11:30"],

  candidates: [
    {
      id: "c1",
      name: "Candidate A",
      availableSlots: ["10:00", "10:30"],
    },
    {
      id: "c2",
      name: "Candidate B",
      availableSlots: ["10:00", "10:30", "11:00", "11:30"],
    },
  ],

  interviewers: [
    {
      id: "i1",
      name: "Interviewer X",
      skills: ["DSA"],
      availableSlots: ["10:00", "10:30", "11:00", "11:30"],
      maxInterviewsPerDay: 2,
    },
  ],

  rooms: [
    {
      id: "r1",
      name: "Room 1",
      availableSlots: ["10:00", "10:30", "11:00", "11:30"],
    },
  ],

  tasks: [
    {
      id: "t1",
      candidateId: "c1",
      roundName: "Coding Interview",
      requiredSkills: ["DSA"],
      durationSlots: 1,
    },
    {
      id: "t2",
      candidateId: "c2",
      roundName: "Coding Interview",
      requiredSkills: ["DSA"],
      durationSlots: 1,
    },
  ],
};

async function testScheduleAPI() {
  try {
    const response = await fetch(
      "http://localhost:5000/api/schedule",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const result = await response.json();

    console.log("HTTP status:", response.status);
    console.log(JSON.stringify(result, null, 2));

    if (!response.ok || result.success !== true) {
      throw new Error("Schedule API test failed.");
    }

    console.log("\nAPI TEST PASSED!");
  } catch (error) {
    console.error("API TEST FAILED:", error.message);
    process.exitCode = 1;
  }
}

testScheduleAPI();