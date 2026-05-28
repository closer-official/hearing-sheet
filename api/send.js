// api/send.js
import { Resend } from 'resend';
import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Vercel上の環境変数からResendのAPIキーを読み込みます
const resend = new Resend(process.env.RESEND_API_KEY);
const JAPANESE_FONT_FILE = 'NotoSansCJKjp-Regular.otf';

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function createContractId() {
    const now = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    return `DVZ-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function normalizeProducts(products, fallback) {
    if (!Array.isArray(products) || products.length === 0) {
        return [fallback];
    }
    return products.map((product, idx) => ({
        name: product.name || `商材${idx + 1}`,
        price: toNumber(product.price),
        apo_fee: toNumber(product.apo_fee),
        com_rate: toNumber(product.com_rate),
        apo_count: toNumber(product.apo_count, 1),
        close_rate: toNumber(product.close_rate),
    }));
}

function safeText(value, fallback = '未入力') {
    if (value === null || value === undefined) return fallback;
    const s = String(value).trim();
    return s.length ? s : fallback;
}

function resolveJapaneseFontPath() {
    const candidates = [
        path.resolve(process.cwd(), 'fonts', JAPANESE_FONT_FILE),
        path.resolve('/var/task', 'fonts', JAPANESE_FONT_FILE),
        path.resolve(path.dirname(process.cwd()), 'fonts', JAPANESE_FONT_FILE),
    ];
    const resolved = candidates.find((fontPath) => existsSync(fontPath));
    if (!resolved) {
        throw new Error(`Japanese font file not found. checked: ${candidates.join(', ')}`);
    }
    return resolved;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const data = req.body || {};
        const contractId = safeText(data.contract_id, createContractId());
        const liabilityCapMonths = safeText(data.liability_cap_months, '3');
        const autoRenewNoticeDays = safeText(data.auto_renew_notice_days, '7');
        const cancelNoticeDays = safeText(data.cancel_notice_days, '7');
        const jurisdiction = safeText(data.jurisdiction, '乙の所在地を管轄する地方裁判所（または簡易裁判所）');
        const products = normalizeProducts(data.products, {
            name: safeText(data.product_name, 'メイン商材'),
            price: toNumber(data.price),
            apo_fee: toNumber(data.apo_fee),
            com_rate: toNumber(data.com_rate),
            apo_count: toNumber(data.apo_count, 1),
            close_rate: toNumber(data.close_rate),
        });

        const japaneseFontPath = resolveJapaneseFontPath();

        // 1. メモリ上でPDF契約書（暫定）を生成
        const doc = new PDFDocument({ margin: 50, font: japaneseFontPath });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        
        return new Promise((resolve) => {
            doc.on('end', async () => {
                const pdfBuffer = Buffer.concat(buffers);

                // 2. Resend APIを使って「Divizero運営代表メール」へ送信
                const emailResponse = await resend.emails.send({
                    from: 'Divizero System <onboarding@resend.dev>',
                    to: 'info@closer-official.com',
                    subject: `【要対応】契約書発行依頼_${safeText(data.name)}様_${contractId}`,
                    html: `
                        <h2>Divizero パートナーシップ申請届</h2>
                        <p><strong>契約書番号:</strong> ${contractId}</p>
                        <p>ヒアリングシートより新しい送信がありました。内容を確認し、GMOサインにて署名手続きを進めてください。</p>
                        <hr />
                        <p><strong>お名前:</strong> ${safeText(data.name)}</p>
                        <p><strong>メールアドレス:</strong> ${safeText(data.email)}</p>
                        <p><strong>インスタURL:</strong> ${safeText(data.insta_url)}</p>
                        <p><strong>商材数:</strong> ${products.length}件</p>
                        <hr />
                        <p>※詳細な回答内容は添付のPDF契約書（ドラフト）をご確認ください。</p>
                    `,
                    attachments: [
                        {
                            filename: `Agreement_${contractId}_${safeText(data.name)}.pdf`,
                            content: pdfBuffer.toString('base64'),
                        }
                    ]
                });

                res.status(200).json({ success: true, message: 'Email and PDF sent successfully', info: emailResponse });
                resolve();
            });

            // 同梱フォントを既定フォントとして登録・固定し、環境依存フォント参照を防止
            doc.registerFont('jp', japaneseFontPath);
            doc.font('jp');
            doc.info.Title = `Divizero契約書ドラフト_${contractId}`;
            doc.info.Author = 'Divizero';
            doc.info.Subject = 'パートナーシップ契約書ドラフト';
            doc.info.Keywords = 'Divizero,契約書,パートナーシップ';

            // --- PDFのデザイン・中身の書き込み ---
            doc.rect(50, 45, 500, 3).fill('#b88a1d');
            doc.fillColor('#111111');
            doc.fontSize(11).text(`契約書番号: ${contractId}`, 50, 58, { align: 'right' });
            doc.fontSize(21).text('Divizero パートナーシップ契約書（ドラフト）', { align: 'center' });
            doc.moveDown(0.7);
            doc.fontSize(10).fillColor('#4f4f4f').text(`作成日: ${new Date().toLocaleDateString('ja-JP')}`, { align: 'right' });
            doc.fillColor('#111111');
            doc.moveDown(0.6);
            doc.fontSize(11).text(`申請者（甲）: ${safeText(data.name)} 様`);
            doc.text(`運営者（乙）: Divizero 運営代表`);
            doc.text(`連絡先: ${safeText(data.email)} / ${safeText(data.insta_url)}`);
            doc.moveDown(0.5);
            doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#d0d0d0').stroke();
            doc.moveDown(1);

            doc.fontSize(13).fillColor('#111111').text('第1条（合意された商材別パラメータ）');
            doc.moveDown(0.6);
            doc.fontSize(10);
            products.forEach((product, idx) => {
                const closeRate = product.close_rate / 100;
                const closeCount = product.apo_count * closeRate;
                const comRevenue = product.price * (product.com_rate / 100) * closeCount;
                const apoRevenue = product.apo_fee * product.apo_count;
                const divizeroTotal = apoRevenue + comRevenue;
                doc.fillColor('#1b1b1b').text(`【商材${idx + 1}】${safeText(product.name)}`);
                doc.fillColor('#333333').text(`・制作単価目安: ${product.price.toLocaleString()} 円`);
                doc.text(`・アポ単価: ${product.apo_fee.toLocaleString()} 円`);
                doc.text(`・成約コミッション率: ${product.com_rate} %`);
                doc.text(`・月間アポ件数: ${product.apo_count} 件`);
                doc.text(`・成約率: ${product.close_rate} %`);
                doc.text(`・乙の月間受取試算: ${Math.round(divizeroTotal).toLocaleString()} 円`);
                doc.moveDown(0.5);
            });

            doc.moveDown(0.5);
            doc.fontSize(9).fillColor('#333333');
            doc.text('第2条（アポ確定基準）');
            doc.fontSize(9).text('1. 事前のヒアリング内容に基づき、ターゲット条件（業種、ニーズ等）を網羅していること。');
            doc.text('2. 見込み客が、甲（パートナー）のInstagramアカウント等のダイレクトメッセージ（DM）へ、直接問い合わせのメッセージを送信した時点をもって、アポの「受付開始」とみなします。');
            doc.text('3. 流入後、明らかな冷やかしを除き、最初のヒアリング対話が1往復以上成立した時点をもってアポ確定（成果発生）と認定する。');
            doc.text('※乙の役割は見込み客を甲のDMへお連れするところまでであり、その後の成約率は甲の提案力に依存します。');
            doc.moveDown();
            doc.fontSize(9).text('第3条（報酬受取・手数料精算サイクル）');
            doc.text(`・甲の報酬受取タイミング: ${safeText(data.payment_timing)}`);
            doc.text(`・Divizeroへの精算サイクル: ${safeText(data.divizero_timing)}`);
            if (safeText(data.divizero_timing).includes('即座に')) {
                doc.fillColor('#a33d26').text('※即時精算合意につき、各手数料精算時に毎回200円の割引を適用します。');
            }
            doc.fillColor('#333333');
            doc.moveDown(0.5);

            doc.text('第4条（不正成約に関する罰則）');
            doc.text('万が一、成約が発生したにもかかわらず成約していないと虚偽の申告をされた場合、発覚時点での設定成約コミッション単価の10倍を、甲は乙へ支払うものとします。');
            doc.moveDown(0.5);

            doc.text('第5条（反社会的勢力の排除）');
            doc.text('甲および乙は、自らが反社会的勢力に該当しないこと、かつ将来にわたっても関係を持たないことを表明し、保証します。違反時は相手方は催告なしに直ちに契約を解除できます。');
            doc.moveDown(0.5);

            doc.text('第6条（有効期間および自動更新）');
            doc.text(`本合意の有効期間は締結日から1ヶ月間とします。ただし、期間満了の${autoRenewNoticeDays}日前までに双方から別段の申し出がない限り、同条件でさらに1ヶ月間自動更新され、以後も同様とします。`);
            doc.moveDown(0.5);

            doc.text('第7条（中途解約の自由）');
            doc.text(`甲および乙は、有効期間内であっても、相手方に対して${cancelNoticeDays === 'いつでも' ? 'いつでも' : `${cancelNoticeDays}日前までに`}通知を行うことで、何らの費用、違約金、解約金等の支払いを要することなく本契約を終了できます。`);
            doc.moveDown(0.5);

            doc.text('第8条（成果保証の免責）');
            doc.text('乙はアポ獲得およびマーケティング支援に最善を尽くしますが、成果そのものを保証するものではありません。目標未達または0件の場合でも、乙は補償・損害賠償・返金その他これらに類する責任を負わないものとします。');
            doc.moveDown(0.5);

            doc.text('第9条（損害賠償の上限）');
            doc.text(`本契約に関連して乙が甲に対して負う損害賠償責任は、事由の如何を問わず、過去${liabilityCapMonths}ヶ月間に甲が乙へ現実に支払った手数料総額を上限とします（手数料支払前は0円）。`);
            doc.moveDown(0.5);

            doc.text('第10条（専属的合意管轄）');
            doc.text(`本契約に関する一切の紛争は、${jurisdiction}を第一審の専属的合意管轄裁判所とします。`);
            doc.moveDown();

            const bankName = process.env.BANK_NAME || '（未設定）';
            const bankBranch = process.env.BANK_BRANCH || '（未設定）';
            const bankType = process.env.BANK_ACCOUNT_TYPE || '普通';
            const bankNumber = process.env.BANK_ACCOUNT_NUMBER || '（未設定）';
            const bankAccountName = process.env.BANK_ACCOUNT_NAME || '（未設定）';

            doc.fontSize(9).fillColor('#333333').text('第11条（手数料のお振込先口座）');
            doc.moveDown(0.3);
            doc.fontSize(10).fillColor('#333333');
            doc.fontSize(10).fillColor('#333333').text(`・金融機関名: ${bankName}`);
            doc.text(`・支店名: ${bankBranch}`);
            doc.text(`・預金種目: ${bankType}`);
            doc.text(`・口座番号: ${bankNumber}`);
            doc.text(`・口座名義: ${bankAccountName}`);
            doc.moveDown(1.5);
            doc.fontSize(10).fillColor('#5a5a5a').text('本書はドラフトです。正式契約はGMOサインにより電子締結します。', { align: 'center' });
            
            doc.end();
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}