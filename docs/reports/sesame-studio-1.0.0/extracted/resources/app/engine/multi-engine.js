/**
 * MULTI-ENGINE DISPATCHER & ADAPTER
 * Hỗ trợ phân phối tác vụ qua 3 nền tảng AI Video hàng đầu:
 *  1. Muse AI (muse.ai) - Tối ưu cho thoại, kịch bản tiếng Việt, tốc độ nhanh
 *  2. Google Flow (flow.google / Veo) - Tối ưu cho bối cảnh điện ảnh cao cấp, vật lý phức tạp
 *  3. Seedance (Seedance 2.0 / 2.5) - Tối ưu cho chuyển động nhân vật, nhất quán đa góc, tương tác vật lý mạnh
 */

const { runTask: runMuseTask } = require('./muse-runner');
const gflowRunner = require('./gflow-runner');
const seedanceRunner = require('./seedance-runner');
const dolaRunner = require('./dola-runner');

const ENGINES = {
  MUSE: 'muse',
  GOOGLE_FLOW: 'google_flow',
  SEEDANCE: 'seedance',
  DOLA: 'dola',
  AUTO: 'auto'
};

/**
 * Phân tích độ nhạy của prompt để quyết định engine tối ưu
 * Nếu cảnh có va chạm vật lý mạnh (hất rượu, đánh đấm, rượt đuổi) -> Ưu tiên Google Flow / Seedance
 */
function recommendEngine(prompt) {
  if (!prompt || typeof prompt !== 'string') return ENGINES.MUSE;
  
  const highActionPatterns = /throw|hit|slap|fight|run|chase|wine|splash|tạt|hất|đánh|rơi|đổ|xô xát|va chạm/i;
  if (highActionPatterns.test(prompt)) {
    return ENGINES.GOOGLE_FLOW; // Cảnh khó -> Chuyển sang Google Flow / Veo
  }
  return ENGINES.MUSE; // Cảnh đối thoại / biểu cảm -> Muse
}

/**
 * Điều phối thực thi task với cơ chế dự phòng (Fallback)
 */
async function dispatchTask(task, context) {
  const provider = context.page?.provider || 'muse';
  const targetEngine = task.engine || ENGINES.AUTO;

  // QUY TẮC AN TOÀN QUOTA: Nếu task chỉ định rõ engine mà tài khoản được gán không khớp,
  // tuyệt đối KHÔNG fallback âm thầm sang Muse hay engine khác làm tiêu tốn quota sai mục đích!
  if (targetEngine !== ENGINES.AUTO && targetEngine !== provider) {
    throw new Error(`[MultiEngine] Task ${task.id} yêu cầu engine '${targetEngine}' nhưng tài khoản được gán là '${provider}'. Không được fallback sang engine khác để tránh tốn quota.`);
  }

  const chosen = targetEngine === ENGINES.AUTO 
    ? (provider !== 'muse' ? provider : recommendEngine(task.prompt)) 
    : targetEngine;

  console.log(`[MultiEngine] Task ${task.id} (provider=${provider}) điều hướng tới engine: ${chosen}`);

  try {
    switch (chosen) {
      case ENGINES.GOOGLE_FLOW:
        return await runGoogleFlowTask(task, context);

      case ENGINES.SEEDANCE:
        return await runSeedanceTask(task, context);

      case ENGINES.DOLA:
        return await runDolaTask(task, context);

      case ENGINES.MUSE:
      default:
        return await runMuseTask(task, context);
    }
  } catch (err) {
    if (err.museResult) {
      console.warn(`[MultiEngine] Muse từ chối task ${task.id}: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Dola AI Runner (Dreamina Seedance 2.0 Fast trên dola.com)
 */
async function runDolaTask(task, context) {
  return await dolaRunner.runTask(task, context);
}

/**
 * Seedance 2.5 Runner (Hỗ trợ qua BytePlus Playground Web CDP hoặc ModelArk API Key)
 */
async function runSeedanceTask(task, context) {
  return await seedanceRunner.runTask(task, context);
}

/**
 * Google Flow Runner (Veo / flow.google)
 */
async function runGoogleFlowTask(task, context) {
  return await gflowRunner.runTask(task, context);
}

module.exports = {
  ENGINES,
  recommendEngine,
  dispatchTask,
  runGoogleFlowTask,
  runSeedanceTask,
  runDolaTask
};
