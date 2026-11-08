import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/site";

// The card that travels with every shared link. Social platforms crop to
// 1.91:1, so the composition keeps its message inside the safe centre.
export const alt = `${SITE_NAME} — ranked heads-up poker`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#14130f",
          color: "#f6f4ef",
          padding: "64px 72px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 8 }}>{SITE_NAME.toUpperCase()}</div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: 19,
              letterSpacing: 4,
              color: "#9a968a",
            }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                background: "#c2402a",
                marginRight: 12,
              }}
            />
            RANKED HEADS-UP
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 94, lineHeight: 1.02, letterSpacing: -2, fontWeight: 600 }}>
            Ten hands.
          </div>
          <div
            style={{
              fontSize: 94,
              lineHeight: 1.02,
              letterSpacing: -2,
              fontWeight: 600,
              color: "#d8cfbc",
            }}
          >
            One rating.
          </div>
          <div
            style={{
              fontSize: 28,
              marginTop: 30,
              color: "#b9b2a2",
              letterSpacing: 1,
            }}
          >
            One rating that follows you between tables.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "2px solid #3a372f",
            paddingTop: 22,
            fontSize: 17,
            letterSpacing: 4,
            color: "#8f8a7d",
          }}
        >
          <div>GLICKO-2</div>
          <div>{"NO-LIMIT HOLD'EM"}</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
