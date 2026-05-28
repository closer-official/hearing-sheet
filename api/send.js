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
        const liabilityCapMonths = '3';
        const autoRenewNoticeDays = '7';
        const cancelNoticeDays = '7';
        const jurisdiction = '乙の所在地を管轄する地方裁判所（または簡易裁判所）';
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

                // 2. Resend APIを使って「Divizero運営代表メール」へ送信（全回答内容を網羅）
                const productHtmlLines = products.map((product, idx) => `
                    <div style="background-color: #1b1b1b; padding: 12px; margin-bottom: 10px; border-left: 4px solid #b88a1d; color: #ececec;">
                        <strong>【商材${idx + 1}】${safeText(product.name)}</strong><br />
                        ・制作単価目安: ${product.price.toLocaleString()} 円<br />
                        ・アポ単価: ${product.apo_fee.toLocaleString()} 円<br />
                        ・成約コミッション率: ${product.com_rate} %<br />
                        ・月間アポ件数: ${product.apo_count} 件<br />
                        ・成約率: ${product.close_rate} %
                    </div>
                `).join('');

                const emailResponse = await resend.emails.send({
                    from: 'Divizero System <onboarding@resend.dev>',
                    to: 'info@closer-official.com',
                    subject: `【要対応】契約書発行依頼_${safeText(data.name)}様`,
                    html: `
                        <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #333333; line-height: 1.6; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #b88a1d; border-bottom: 2px solid #b88a1d; padding-bottom: 8px;">Divizero パートナーシップ申請届（全回答内訳）</h2>
                            <p>ヒアリングシートより新しい送信がありました。内容を確認し、GMOサインにて署名手続きを進めてください。</p>
                            
                            <h3 style="color: #b88a1d; margin-top: 20px;">■ 基本情報</h3>
                            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                                <tr><td style="width: 35%; padding: 6px; border-bottom: 1px solid #ddd; font-weight: bold;">お名前:</td><td style="padding: 6px; border-bottom: 1px solid #ddd;">${safeText(data.name)}</td></tr>
                                <tr><td style="padding: 6px; border-bottom: 1px solid #ddd; font-weight: bold;">メールアドレス:</td><td style="padding: 6px; border-bottom: 1px solid #ddd;">${safeText(data.email)}</td></tr>
                                <tr><td style="padding: 6px; border-bottom: 1px solid #ddd; font-weight: bold;">インスタURL:</td><td style="padding: 6px; border-bottom: 1px solid #ddd;">${safeText(data.insta_url || data.instagram)}</td></tr>
                                <tr><td style="padding: 6px; border-bottom: 1px solid #ddd; font-weight: bold;">得意ジャンル:</td><td style="padding: 6px; border-bottom: 1px solid #ddd;">${safeText(data.genre)}</td></tr>
                                <tr><td style="padding: 6px; border-bottom: 1px solid #ddd; font-weight: bold;">対応可能案件数/月:</td><td style="padding: 6px; border-bottom: 1px solid #ddd;">${toNumber(data.max_cases)} 件</td></tr>
                            </table>

                            <h3 style="color: #b88a1d; margin-top: 20px;">■ ターゲット設定</h3>
                            <div style="background-color: #f9f9f9; padding: 12px; border-radius: 6px; margin-bottom: 15px;">
                                <strong>理想のクライアント像:</strong><br />
                                <p style="white-space: pre-wrap; margin: 4px 0 10px 0;">${safeText(data.ideal_client)}</p>
                                <strong>避けたい案件・クライアント:</strong><br />
                                <p style="white-space: pre-wrap; margin: 4px 0 0 0;">${safeText(data.avoid_client)}</p>
                            </div>

                            <h3 style="color: #b88a1d; margin-top: 20px;">■ 料金プラン・シミュレーション</h3>
                            <p style="margin-bottom: 10px;"><strong>商材数:</strong> ${products.length}件</p>
                            ${productHtmlLines}

                            <h3 style="color: #b88a1d; margin-top: 20px;">■ 決済・精算サイクル</h3>
                            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                                <tr><td style="width: 35%; padding: 6px; border-bottom: 1px solid #ddd; font-weight: bold;">顧客からの受取時期:</td><td style="padding: 6px; border-bottom: 1px solid #ddd;">${safeText(data.payment_timing)}</td></tr>
                                <tr><td style="padding: 6px; border-bottom: 1px solid #ddd; font-weight: bold;">Divizeroへの精算希望:</td><td style="padding: 6px; border-bottom: 1px solid #ddd;">${safeText(data.divizero_timing)}</td></tr>
                            </table>

                            <hr style="border: 0; border-top: 1px solid #b88a1d; margin-top: 30px;" />
                            <p style="font-size: 11px; color: #666666;">※詳細および法的な合意内容は添付のPDF契約書をご確認ください。</p>
                        </div>
                    `,
                    attachments: [
                        {
                            filename: `Agreement_${safeText(data.name)}.pdf`,
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
            doc.info.Title = 'Divizero契約書';
            doc.info.Author = 'Divizero';
            doc.info.Subject = 'パートナーシップ契約書';
            doc.info.Keywords = 'Divizero,契約書,パートナーシップ';

            // --- PDFのデザイン・中身の書き込み ---
            doc.rect(50, 45, 500, 3).fill('#b88a1d');
            doc.fillColor('#111111');
            doc.fontSize(21).text('Divizero パートナーシップ契約書', { align: 'center' });
            doc.moveDown(0.7);
            doc.fontSize(10).fillColor('#4f4f4f').text(`作成日: ${new Date().toLocaleDateString('ja-JP')}`, { align: 'right' });
            doc.fillColor('#111111');
            doc.moveDown(0.6);
            doc.fontSize(11).text(`申請者（甲）: ${safeText(data.name)} 様`);
            doc.text(`運営者（乙）: Divizero 運営代表`);
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

            doc.text('第6条（料金適用期間および契約更新に関する特約）');
            doc.text('1. 本契約（第1条）に定める各種料金諸条件（アポ単価、成約コミッション率、および総コミッション最低額）は、稼働開始月を含む「最初の2ヶ月間（お試し期間）」に限り適用される特別割引料金とします。');
            doc.text('2. 稼働開始から2ヶ月が経過する契約満了のタイミングにおいて、甲および乙は継続の有無、ならびにそれまでの稼働成果（アポ獲得数・成約率等）の確認を行うものとします。');
            doc.text('3. 甲乙双方が契約継続に合意した場合、初期2ヶ月間の実際の成果データを基準とし、3ヶ月目以降の適正料金（アポ単価：最低2,000円〜 / 成約コミッション：最低10%〜 / 総コミッション最低15,000円〜を基準とする）を双方合意の上で再設定し、速やかに契約書を再発行・再締結するものとします。');
            doc.text('4. 2ヶ月目終了のタイミングで甲乙いずれかより継続を希望しない旨の申し出があった場合、本契約は延長されることなく、お試し期間（2ヶ月）の満了をもって円満に終了（解約金・違約金なし）するものとします。');
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
            doc.fontSize(10).fillColor('#5a5a5a').text('本契約はGMOサインにより電子締結します。', { align: 'center' });
            
            doc.end();
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}