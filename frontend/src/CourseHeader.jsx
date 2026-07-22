// Course branding header. The signature element is a timestamp ruler —
// a literal visual echo of the product's core promise (ask anything,
// land on the exact second), scaled to the course's real runtime.

const TOTAL_MINUTES = 22 * 60 + 41; // 22h 41m, the course's actual runtime
const HOUR_TICKS = [0, 4, 8, 12, 16, 20]; // sparse ticks, plus end label separately

function formatHourTick(hour) {
  return `${hour}h`;
}

export default function CourseHeader() {
  return (
    <header className="course-header">
      <div className="course-header-top">
        <span className="course-eyebrow">Ask anything from</span>
        <h1 className="course-title">
          Complete Mobile Developer <span className="course-title-sub">— React Native & Expo</span>
        </h1>
        <p className="course-desc">
          22 hours of lessons on components, navigation, APIs, sensors, camera, maps, and auth —
          ask a question, get the module, the lesson, and the exact second it's taught.
        </p>
      </div>

      <div className="course-stats">
        <span>19 sections</span>
        <span className="dot">·</span>
        <span>89 lectures</span>
        <span className="dot">·</span>
        <span>22h 41m</span>
        <span className="dot">·</span>
        <span className="course-rating">★ 4.9</span>
      </div>
    </header>
  );
}