import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import requestHeaderImage from './assets/vacation-request-header.png';
import { addDays, isLithuanianHoliday, isWeekendDate, parseIsoDate } from './utilsDate';

const PDF_PAGE_WIDTH_PX = 794;
const PDF_PAGE_MIN_HEIGHT_PX = 1123;
const DIRECTOR_NAME = 'Modestas Skierus';
const DIRECTOR_ROLE = 'Direktorius';
const REQUEST_CITY = 'Kaunas';
const VACATION_REQUEST_FILE_PREFIX = 'Atostogu-prasymas';
const PDF_WRAPPER_ID = 'vacation-request-pdf-root';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatLocalIsoDate(value = new Date()) {
  const parsed = value instanceof Date ? value : new Date(value);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/Vilnius',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value || '0000';
  const month = parts.find((part) => part.type === 'month')?.value || '00';
  const day = parts.find((part) => part.type === 'day')?.value || '00';
  return `${year}-${month}-${day}`;
}

function countWorkingDays(startDateIso, endDateIso) {
  const startDate = parseIsoDate(startDateIso);
  const endDate = parseIsoDate(endDateIso);
  let cursor = startDate;
  let total = 0;

  while (cursor <= endDate) {
    if (!isWeekendDate(cursor) && !isLithuanianHoliday(cursor)) {
      total += 1;
    }
    cursor = addDays(cursor, 1);
  }

  return total;
}

function sanitizeFileNamePart(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function buildRequestMarkup({
  employeeName,
  employeePosition,
  requestDate,
  startDate,
  endDate,
  workingDays,
}) {
  const safePosition = employeePosition
    ? escapeHtml(employeePosition)
    : '______________________________';

  return `
    <div
      style="
        width: ${PDF_PAGE_WIDTH_PX}px;
        min-height: ${PDF_PAGE_MIN_HEIGHT_PX}px;
        box-sizing: border-box;
        padding: 56px 76px 88px;
        background: #ffffff;
        color: #1e2823;
        font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;
      "
    >
      <img
        src="${requestHeaderImage}"
        alt="Eigida"
        style="display:block; width:216px; height:auto; margin:0 0 22px 0;"
      />

      <div style="font-size:18px; line-height:1.45; margin-bottom:44px;">
        <div>UAB EIGIDA</div>
        <div>Direktoriui</div>
        <div>${escapeHtml(DIRECTOR_NAME)}</div>
      </div>

      <div style="text-align:center; margin-bottom:28px;">
        <div style="font-size:24px; font-weight:700; letter-spacing:0.2px;">
          PRAŠYMAS DĖL ATOSTOGŲ
        </div>
      </div>

      <div style="font-size:18px; margin-bottom:18px;">${REQUEST_CITY}</div>

      <div style="width:164px; text-align:center; margin-bottom:40px;">
        <div style="font-size:18px;">${requestDate}</div>
        <div style="border-top:1px solid #6c6c6c; margin-top:6px; padding-top:4px; font-size:12px;">
          Data
        </div>
      </div>

      <div style="font-size:18px; line-height:1.8;">
        <div><strong>Vardas, pavardė:</strong> ${escapeHtml(employeeName)}</div>
        <div><strong>Pareigos:</strong> ${safePosition}</div>
        <div style="margin-top:18px;">Prašau suteikti man kasmetines atostogas šiuo laikotarpiu:</div>
        <div style="margin-top:10px;">
          <strong>Nuo:</strong> ${escapeHtml(startDate)}
          <span style="display:inline-block; width:14px;"></span>
          <strong>iki:</strong> ${escapeHtml(endDate)} (imtinai)
        </div>
        <div style="margin-top:10px;">
          <strong>Iš viso darbo dienų:</strong> ${workingDays}
        </div>
      </div>

      <div style="font-size:18px; margin-top:48px;">
        Darbuotojo parašas: _______________________
      </div>

      <div style="margin-top:170px; font-size:18px; line-height:1.7;">
        <div>
          Tvirtinu: ${DIRECTOR_ROLE} ${escapeHtml(DIRECTOR_NAME)}
          <span style="display:inline-block; width:18px;"></span>
          ${requestDate}
        </div>
        <div style="margin-top:22px;">_____________________________________________________</div>
        <div style="margin-top:8px; font-size:14px;">
          Vadovo vardas, pavardė, pareigos, data, parašas.
        </div>
      </div>
    </div>
  `;
}

function createRenderContainer(markup) {
  const existing = document.getElementById(PDF_WRAPPER_ID);
  if (existing) {
    existing.remove();
  }

  const wrapper = document.createElement('div');
  wrapper.id = PDF_WRAPPER_ID;
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-10000px';
  wrapper.style.top = '0';
  wrapper.style.zIndex = '-1';
  wrapper.style.pointerEvents = 'none';
  wrapper.style.opacity = '0';
  wrapper.innerHTML = markup;
  document.body.appendChild(wrapper);
  return wrapper;
}

async function waitForAssets(root) {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const images = [...root.querySelectorAll('img')];
  await Promise.all(
    images.map(
      (image) =>
        new Promise((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }

          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        }),
    ),
  );
}

export async function generateVacationRequestPdf({
  employeeName,
  employeePosition,
  startDate,
  endDate,
  submittedAt,
}) {
  const requestDate = formatLocalIsoDate(submittedAt);
  const workingDays = countWorkingDays(startDate, endDate);
  const markup = buildRequestMarkup({
    employeeName,
    employeePosition,
    requestDate,
    startDate,
    endDate,
    workingDays,
  });
  const wrapper = createRenderContainer(markup);

  try {
    await waitForAssets(wrapper);
    const canvas = await html2canvas(wrapper.firstElementChild, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    });

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const imageData = canvas.toDataURL('image/png');
    pdf.addImage(imageData, 'PNG', 0, 0, 210, 297, undefined, 'FAST');

    const employeePart = sanitizeFileNamePart(employeeName) || 'darbuotojas';
    pdf.save(`${VACATION_REQUEST_FILE_PREFIX}-${employeePart}-${startDate}-${endDate}.pdf`);
  } finally {
    wrapper.remove();
  }
}
