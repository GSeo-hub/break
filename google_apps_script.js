/**
 * INU 벽돌깨기 게임 결과 기록 및 최단 완료시간 Top 3 산출용 Google Apps Script
 * 스프레드시트 URL: https://docs.google.com/spreadsheets/d/1hqXOZEfYQ7Y-YmgAt0_SkDMjmkzNcI2JbBsyLTTPQss/edit
 */

// finishtime을 초 단위(seconds)로 정확하게 변환하는 헬퍼 함수
function parseTimeToSeconds(val, dispText) {
  // 1. 화면에 표시된 텍스트(예: "00:00:07" 또는 "00:07") 우선 파싱
  var textStr = dispText ? String(dispText).trim() : (val ? String(val).trim() : "");
  if (textStr && textStr.indexOf(":") !== -1) {
    var parts = textStr.split(":");
    if (parts.length === 3) {
      var h = parseInt(parts[0], 10) || 0;
      var m = parseInt(parts[1], 10) || 0;
      var s = parseInt(parts[2], 10) || 0;
      return h * 3600 + m * 60 + s;
    } else if (parts.length === 2) {
      var m = parseInt(parts[0], 10) || 0;
      var s = parseInt(parts[1], 10) || 0;
      return m * 60 + s;
    }
  }

  // 2. Date 객체인 경우 (구글 시트 타임 포맷)
  if (val instanceof Date) {
    var h = val.getHours();
    var m = val.getMinutes();
    var s = val.getSeconds();
    return h * 3600 + m * 60 + s;
  }

  // 3. 숫자 (시트 일련번호: 1일 = 86400초)
  if (typeof val === "number" && !isNaN(val)) {
    return Math.round(val * 86400);
  }

  return 999999;
}

// 초 단위 시간을 "분:초" (예: 00:07) 또는 "시:분:초"로 포맷팅
function formatSecondsToDisplay(totalSec) {
  var m = Math.floor(totalSec / 60);
  var s = totalSec % 60;
  return (m < 10 ? "0" + m : "" + m) + ":" + (s < 10 ? "0" + s : "" + s);
}

// 구글 시트에 저장된 전체 데이터 중 종료시간이 가장 빠른 Top 3 산출 함수 (오름차순)
function getTop3Leaderboard(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }

  // 원시 값(getValues) 및 포맷팅된 표시 텍스트(getDisplayValues) 함께 조회
  var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var displayValues = sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues();
  var records = [];

  for (var i = 0; i < values.length; i++) {
    var rawName = values[i][1];
    var name = (rawName !== undefined && rawName !== null && String(rawName).trim() !== "") 
                 ? String(rawName).trim() 
                 : "익명";

    var rawTime = values[i][2];
    var dispTime = displayValues[i][2];

    var totalSec = parseTimeToSeconds(rawTime, dispTime);

    if (totalSec > 0 && totalSec < 999999) {
      records.push({
        name: name,
        seconds: totalSec,
        finishtime: formatSecondsToDisplay(totalSec)
      });
    }
  }

  // 종료시간(seconds) 기준 오름차순(가장 빠른 시간부터) 정렬
  records.sort(function(a, b) {
    return a.seconds - b.seconds;
  });

  // 상위 3명 반환
  return records.slice(0, 3);
}

// POST 요청: 게임 성공 기록 저장 및 최단 완료시간 Top 3 즉시 반환
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // 헤더가 없는 경우 첫 행 자동 생성
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["timestamp", "name", "finishtime"]);
      sheet.getRange(1, 1, 1, 3).setFontWeight("bold");
    }

    var data = {};
    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (err) {
        data = e.parameter;
      }
    } else if (e.parameter) {
      data = e.parameter;
    }

    var playerName = data.name || "익명";
    var seconds = parseInt(data.seconds, 10);
    var now = new Date();

    // 24시간 fraction: seconds / 86400
    var timeFraction;
    if (!isNaN(seconds) && seconds >= 0) {
      timeFraction = seconds / 86400.0;
    } else {
      var parts = (data.finishtime || "00:00").split(":");
      var m = parseInt(parts[0], 10) || 0;
      var s = parseInt(parts[1], 10) || 0;
      timeFraction = (m * 60 + s) / 86400.0;
    }

    // 1행 추가
    sheet.appendRow([now, playerName, timeFraction]);
    var newRow = sheet.getLastRow();

    // 형식 지정 (timestamp: 날짜시간, name: 문자, finishtime: 24시간 형식)
    sheet.getRange(newRow, 1).setNumberFormat("yyyy-MM-dd HH:mm:ss");
    sheet.getRange(newRow, 2).setNumberFormat("@");
    sheet.getRange(newRow, 3).setNumberFormat("HH:mm:ss");

    // 저장 직후 최신 오름차순 Top 3 계산
    var top3 = getTop3Leaderboard(sheet);

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "성공적으로 저장되었습니다.",
      top3: top3
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);

  } finally {
    lock.releaseLock();
  }
}

// GET 요청: 실시간 Top 3 조회
function doGet(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var top3 = getTop3Leaderboard(sheet);

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      top3: top3
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString(),
      top3: []
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
