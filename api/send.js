// api/send.js
import { Resend } from 'resend';
import PDFDocument from 'pdfkit';
import path from 'path';

// Vercel上の環境変数からResendのAPIキーを読み込みます
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const data = req.body;

        // 1. メモリ上でPDF契約書（暫定）を生成
        const doc = new PDFDocument({ margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        
        return new Promise((resolve) => {
            doc.on('end', async () => {
                const pdfBuffer = Buffer.concat(buffers);

                // 2. Resend APIを使って「Divizero運営代表メール」へ送信
                const emailResponse = await resend.emails.send({
                    from: 'Divizero System <onboarding@resend.dev>',
                    to: 'info@closer-official.com',
                    subject: `【要対応】契約書発行依頼_${data.name}様`,
                    html: `
                        <h2>Divizero パートナーシップ申請届</h2>
                        <p>ヒアリングシートより新しい送信がありました。内容を確認し、GMOサインにて署名手続きを進めてください。</p>
                        <hr />
                        <p><strong>お名前:</strong> ${data.name}</p>
                        <p><strong>メールアドレス:</strong> ${data.email}</p>
                        <p><strong>インスタURL:</strong> ${data.insta_url}</p>
                        <p><strong>策定プラン:</strong> 単価 ¥${parseInt(data.price).toLocaleString()} / アポ単価 ¥${parseInt(data.apo_fee).toLocaleString()} / コミッション ${data.com_rate}%</p>
                        <hr />
                        <p>※詳細な回答内容は添付のPDF契約書（ドラフト）をご確認ください。</p>
                    `,
                    attachments: [
                        {
                            filename: `Agreement_Draft_${data.name}.pdf`,
                            content: pdfBuffer.toString('base64'),
                        }
                    ]
                });

                res.status(200).json({ success: true, message: 'Email and PDF sent successfully', info: emailResponse });
                resolve();
            });

            // --- 【確実な手段】プロジェクト内のフォントファイルを絶対パスで直接読み込む ---
            // ※「fonts/NotoSansJP-Regular.ttf」の部分は、ご自身が配置したフォントファイル名に書き換えてください
            const fontPath = path.join(process.cwd(), 'fonts', 'NotoSansJP-Regular.ttf');
            doc.font(fontPath);

            // --- PDFのデザイン・中身の書き込み ---
            doc.fontSize(18).text('Divizero パートナーシッププラン合意書 (ドラフト)', { align: 'center' });
            doc.moveDown();
            doc.fontSize(10).text(`作成日: ${new Date().toLocaleDateString('ja-JP')}`);
            doc.text(`申請者（甲）: ${data.name} 様`);
            doc.text(`運営者（乙）: Divizero 運営代表`);
            doc.moveDown();
            doc.text('==================================================================');
            doc.moveDown();
            
            doc.fontSize(12).text(`【合意されたプランパラメータ】`);
            doc.fontSize(10).text(`・想定制作単価の目安: ${parseInt(data.price).toLocaleString()} 円`);
            doc.text(`--------- 希望アポ単価: ${parseInt(data.apo_fee).toLocaleString()} 円`);
            doc.text(`--------- 成約コミッション率: ${data.com_rate} %`);
            doc.text(`--------- 月間アポ件数: ${data.apo_count} 件`);
            doc.moveDown();
            
            // ★新規追記：アポ確定条件の厳格な明文化
            doc.fontSize(12).text(`【重要：アポ確定に関する判定基準】`);
            doc.fontSize(9).text(`1. 事前のヒアリング内容に基づき、ターゲット条件（業種、ニーズ等）を網羅していること。`);
            doc.text(`2. 甲（パートナー）のInstagramアカウント等の指定窓口へ見込み客が直接流入した時点を発生とする。`);
            doc.text(`3. 流入後、明らかな冷やかしを除き、最初のヒアリング対話が1往復以上成立した時点をもってアポ確定（成果発生）と認定する。`);
            doc.text(`※乙の役割は見込み客を甲のDMへお連れするところまでであり、その後の成約率は甲の提案力に依存します。`);
            doc.moveDown();

            doc.fontSize(12).text(`【報酬受取・手数料精算サイクル】`);
            doc.fontSize(10).text(`・甲の報酬受取タイミング: ${data.payment_timing}`);
            doc.text(`・Divizeroへの精算サイクル: ${data.divizero_timing}`);
            
            if (data.divizero_timing.includes('即座に')) {
                doc.fillColor('#e55039').text(`※特記事項: 即時精算合意につき、各手数料精算時に毎回200円の割引が適用されます。`).fillColor('#000000');
            }
            doc.moveDown();

            const bankName = process.env.BANK_NAME || '（未設定）';
            const bankBranch = process.env.BANK_BRANCH || '（未設定）';
            const bankType = process.env.BANK_ACCOUNT_TYPE || '普通';
            const bankNumber = process.env.BANK_ACCOUNT_NUMBER || '（未設定）';
            const bankAccountName = process.env.BANK_ACCOUNT_NAME || '（未設定）';

            doc.fontSize(12).text(`【手数料のお振込先口座】`);
            doc.fontSize(10).text(`・金融機関名: ${bankName}`);
            doc.text(`・支店名: ${bankBranch}`);
            doc.text(`・預金種目: ${bankType}`);
            doc.text(`・口座番号: ${bankNumber}`);
            doc.text(`・口座名義: ${bankAccountName}`);
            doc.moveDown();
            
            doc.fontSize(12).text(`【不正成約に関する罰則規定】`);
            doc.fontSize(9).text(`万が一、成約が発生したにもかかわらず成約していないと虚偽の申告をされた場合、発覚時点での設定成約コミッション単価の10倍をDivizeroへお支払いいただきます。本規定はプラン合意時点で効力が生じます。`);
            doc.moveDown(2);
            doc.fontSize(10).text('上記内容に基づき、乙から甲へGMOサインを通じて正式な電子契約書を締結します。', { color: 'gray' });
            
            doc.end();
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}