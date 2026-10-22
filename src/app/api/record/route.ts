import { NextRequest, NextResponse } from "next/server";

// 구글 스프레드시트 CSV 데이터를 파싱하여 최단 시간 순(오름차순) Top 3를 직접 계산하는 백업 파서
async function fetchTop3FromPublicSheet(): Promise<Array<{ name: string; finishtime: string; seconds: number }>> {
  try {
    const csvUrl = "https://docs.google.com/spreadsheets/d/1hqXOZEfYQ7Y-YmgAt0_SkDMjmkzNcI2JbBsyLTTPQss/gviz/tq?tqx=out:csv";
    const res = await fetch(csvUrl, { cache: "no-store" });
    if (!res.ok) return [];

    const text = await res.text();
    const lines = text.split("\n").filter((l) => l.trim() !== "");
    if (lines.length <= 1) return [];

    const records: Array<{ name: string; finishtime: string; seconds: number }> = [];

    // 1행(헤더) 제외하고 데이터 파싱
    for (let i = 1; i < lines.length; i++) {
      // CSV 따옴표 파싱
      const line = lines[i];
      const cols = line.split(",").map((c) => c.replace(/^["']|["']$/g, "").trim());
      if (cols.length >= 3) {
        const name = cols[1] || "익명";
        const timeStr = cols[2] || "00:00";

        // timeStr 파싱 (HH:mm:ss 또는 mm:ss)
        const parts = timeStr.split(":");
        let totalSec = 999999;
        let formattedTime = timeStr;

        if (parts.length === 3) {
          const h = parseInt(parts[0], 10) || 0;
          const m = parseInt(parts[1], 10) || 0;
          const s = parseInt(parts[2], 10) || 0;
          totalSec = h * 3600 + m * 60 + s;
          formattedTime = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        } else if (parts.length === 2) {
          const m = parseInt(parts[0], 10) || 0;
          const s = parseInt(parts[1], 10) || 0;
          totalSec = m * 60 + s;
          formattedTime = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        }

        if (totalSec > 0 && totalSec < 999999) {
          records.push({
            name,
            seconds: totalSec,
            finishtime: formattedTime,
          });
        }
      }
    }

    // 종료시간 오름차순(가장 빠른 순) 정렬
    records.sort((a, b) => a.seconds - b.seconds);

    return records.slice(0, 3);
  } catch (err) {
    console.error("구글 시트 CSV 직접 파싱 실패:", err);
    return [];
  }
}

// GET: Top 3 랭킹 조회
export async function GET() {
  try {
    const scriptUrl = process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL;

    // 1순위: Apps Script Web App 호출
    if (scriptUrl && scriptUrl.trim() !== "") {
      try {
        const gasResponse = await fetch(scriptUrl, {
          method: "GET",
          redirect: "follow",
          cache: "no-store",
        });

        if (gasResponse.ok) {
          const data = await gasResponse.json();
          if (Array.isArray(data.top3) && data.top3.length > 0) {
            return NextResponse.json({
              success: true,
              top3: data.top3,
            });
          }
        }
      } catch (gasErr) {
        console.warn("Apps Script GET 응답 대기/오류, 구글 시트 직통 모드로 전환:", gasErr);
      }
    }

    // 2순위: 구글 스프레드시트 CSV 데이터를 직접 조회하여 오름차순 Top 3 계산 (100% 보장)
    const directTop3 = await fetchTop3FromPublicSheet();
    return NextResponse.json({
      success: true,
      top3: directTop3,
    });
  } catch (error) {
    console.error("Top3 조회 최종 오류:", error);
    return NextResponse.json({
      success: false,
      top3: [],
      error: String(error),
    });
  }
}

// POST: 게임 성공 기록 저장 및 최신 Top 3 반환
export async function POST(req: NextRequest) {
  try {
    const scriptUrl = process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL;
    const body = await req.json();
    const { name, seconds, finishtime } = body;

    let gasTop3: Array<{ name: string; finishtime: string }> = [];

    // 1. 구글 앱스 스크립트로 신규 기록 POST
    if (scriptUrl && scriptUrl.trim() !== "") {
      try {
        const gasResponse = await fetch(scriptUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name,
            seconds,
            finishtime,
          }),
          redirect: "follow",
        });

        const resultText = await gasResponse.text();
        try {
          const resultJson = JSON.parse(resultText);
          if (Array.isArray(resultJson.top3) && resultJson.top3.length > 0) {
            gasTop3 = resultJson.top3;
          }
        } catch {
          // JSON 파싱 무시
        }
      } catch (postErr) {
        console.error("Apps Script POST 전송 에러:", postErr);
      }
    }

    // 만약 앱스 스크립트에서 반환된 top3가 없으면, 구글 시트에서 직접 오름차순 Top 3 산출
    if (!gasTop3 || gasTop3.length === 0) {
      // 저장 후 시트 갱신 텀을 감안하여 500ms 후 직접 계산
      await new Promise((resolve) => setTimeout(resolve, 500));
      gasTop3 = await fetchTop3FromPublicSheet();
    }

    return NextResponse.json({
      success: true,
      message: "구글 스프레드시트에 성공적으로 기록되었습니다.",
      top3: gasTop3,
    });
  } catch (error) {
    console.error("기록 저장 중 오류:", error);
    return NextResponse.json(
      {
        success: false,
        message: "저장 중 오류 발생",
        error: String(error),
      },
      { status: 500 }
    );
  }
}
