// Course branding header.

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