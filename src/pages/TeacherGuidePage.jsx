import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const SYSTEM_BLOCKS = [
    {
        title: 'Kho đề thi',
        icon: 'journal-text',
        tone: 'indigo',
        summary: 'Đây là lõi vận hành thật của hệ thống. Mọi thứ nên bắt đầu từ đề nguồn sạch rồi mới nghĩ đến ngân hàng.',
        points: [
            'Mỗi đề là một document trong exams và một bộ câu trong exams/{examId}/questions.',
            'Giáo viên soạn, sửa, mở thi, phát live và trình chiếu đều dựa trên đề nguồn này.',
            'Nếu chưa có ngân hàng, hệ thống vẫn dùng tốt chỉ với kho đề.',
        ],
    },
    {
        title: 'Ngân hàng câu hỏi',
        icon: 'database',
        tone: 'violet',
        summary: 'Ngân hàng là tầng tái sử dụng, không phải bước bắt buộc đầu tiên. Nó mạnh khi câu hỏi đã được chuẩn hóa.',
        points: [
            'bankItems lưu câu hỏi rời, không lưu cả đề hoàn chỉnh.',
            'Có ngân hàng cá nhân của giáo viên và ngân hàng hệ thống của admin.',
            'Muốn tạo đề theo ma trận thì chapter, difficulty, type phải được gắn tử tế.',
        ],
    },
    {
        title: 'Thư viện đề',
        icon: 'collection',
        tone: 'emerald',
        summary: 'sharedExams là kho đề hoàn chỉnh để giáo viên nhập nhanh, khác hoàn toàn với ngân hàng câu hỏi.',
        points: [
            'Dùng khi muốn phát một bộ đề thành phẩm cho giáo viên khác.',
            'Không dùng sharedExams để thay thế system bank.',
            'Câu hỏi trong thư viện vẫn có thể tiếp tục sync sang ngân hàng riêng sau khi import.',
        ],
    },
    {
        title: 'Kết quả và live',
        icon: 'bar-chart-line',
        tone: 'amber',
        summary: 'sessions, liveRooms và các trang kết quả là đầu ra của cả vòng đời đề thi.',
        points: [
            'sessions lưu từng lượt nộp bài của học sinh.',
            'Live dùng lại đề nguồn, không phải một engine nội dung riêng.',
            'Trình chiếu HTML mới cũng tái dùng chính đề đó để chữa bài.',
        ],
    },
];

const ROADMAP = [
    {
        step: 'Giai đoạn 1',
        title: 'Chưa có gì: chỉ cần tạo được 1 đề sạch',
        copy: 'Bỏ qua ngân hàng trong 1-2 tuần đầu. Mục tiêu duy nhất là giáo viên tạo, kiểm tra và mở được một đề cố định chạy ổn.',
        tasks: [
            'Vào Tạo đề, import hoặc soạn tay một đề thật.',
            'Rà đáp án, lời giải, ảnh, section trong trang Chi tiết đề.',
            'Mở thi cho một nhóm học sinh nhỏ trước.',
        ],
    },
    {
        step: 'Giai đoạn 2',
        title: 'Có vài đề rồi: bắt đầu sync vào ngân hàng cá nhân',
        copy: 'Chỉ sync những đề đã dọn sạch. Không sync bản nháp lộn xộn vì sẽ làm bẩn ngân hàng ngay từ đầu.',
        tasks: [
            'Chọn các đề ổn định và sync sang private bank.',
            'Vào ngân hàng để gắn chapter và difficulty.',
            'Xóa hoặc bỏ qua các câu không đáng tái sử dụng.',
        ],
    },
    {
        step: 'Giai đoạn 3',
        title: 'Ngân hàng dùng được: chuẩn hóa metadata',
        copy: 'Đến lúc này mới nên nghĩ đến ma trận. Nếu chapter đặt lung tung hoặc độ khó không đều, đề ngẫu nhiên sẽ rất kém chất lượng.',
        tasks: [
            'Thống nhất tên chương theo một chuẩn chung.',
            'Quy ước độ khó 1-2-3 đủ rõ giữa các giáo viên.',
            'Tách rõ câu luyện tập, câu kiểm tra, câu nâng cao.',
        ],
    },
    {
        step: 'Giai đoạn 4',
        title: 'Vận hành bài bản: dùng ma trận, live và thư viện',
        copy: 'Khi bank đã sạch, giáo viên có thể tạo đề theo ma trận, còn super admin có thể chọn phần tinh hoa để đẩy lên system bank hoặc shared library.',
        tasks: [
            'Tạo đề cố định hoặc đề động từ ngân hàng.',
            'Tái dùng đề cho thi thường, live và trình chiếu.',
            'Admin chỉ publish nội dung đã được rà soát kỹ lên system bank.',
        ],
    },
];

const REAL_WORKFLOW = [
    {
        index: '01',
        title: 'Soạn đề nguồn đầu tiên',
        where: 'Tạo đề → /teacher/upload',
        action: 'Ví dụ thầy Minh dạy Toán 12, muốn làm đề “Khảo sát hàm số - luyện tập 15 câu”. Thầy import DOCX hoặc soạn tay, lưu ở trạng thái Nháp.',
        output: 'Hệ thống tạo 1 exam và 15 question docs. Đây là bản nguồn chỉnh sửa được.',
    },
    {
        index: '02',
        title: 'Rà đề cho sạch trước khi sync',
        where: 'Chi tiết đề → /teacher/exam/:examId',
        action: 'Kiểm tra import shield, sửa câu nhận sai, thêm lời giải, chỉnh thời gian, số lượt, section và cài đặt trộn nếu cần.',
        output: 'Đề sạch, đủ metadata, đủ lời giải để vừa thi vừa chữa bài.',
    },
    {
        index: '03',
        title: 'Sync sang ngân hàng cá nhân',
        where: 'Trong trang Chi tiết đề hoặc tab Ngân hàng',
        action: 'Bật đồng bộ sang private bank cho bộ câu đã đạt chuẩn. Không sync các đề thử nghiệm hoặc đề chưa rà xong.',
        output: '15 câu xuất hiện dưới dạng bankItems scope=private.',
    },
    {
        index: '04',
        title: 'Chuẩn hóa chapter và difficulty',
        where: 'Ngân hàng câu → /teacher/bank',
        action: 'Gán các câu vào chương “Khảo sát hàm số”, chia độ khó 1-2-3, sửa những câu thiếu metadata.',
        output: 'Ngân hàng bắt đầu dùng được để lọc, nhóm và tạo đề theo ma trận.',
    },
    {
        index: '05',
        title: 'Tạo một đề luyện mới từ ngân hàng',
        where: 'Ngân hàng câu → Tạo đề tự động',
        action: 'Khai báo ma trận ví dụ: 6 câu dễ, 6 câu trung bình, 3 câu khó trong cùng chương. Chọn mode giữ bộ cố định hoặc mỗi học sinh một bộ.',
        output: 'Hệ thống tạo ra một exam mới, nhưng nguồn câu lấy từ bank thay vì gõ tay lại từ đầu.',
    },
    {
        index: '06',
        title: 'Mở thi cho học sinh',
        where: 'Chi tiết đề mới → Kích hoạt',
        action: 'Bật trạng thái active, gửi link lớp hoặc để học sinh vào dashboard. Nếu muốn chữa bài trên lớp thì mở live hoặc trình chiếu HTML.',
        output: 'Học sinh nhìn thấy đề và có thể vào làm ở QuizPage.',
    },
    {
        index: '07',
        title: 'Xem kết quả và rút câu tốt về bank',
        where: 'Kết quả thi → /teacher/exam/:examId/sessions',
        action: 'Sau khi có bài nộp, xem câu nào nhiều học sinh sai, câu nào nhiễu tốt, câu nào nên sửa. Bộ câu tốt tiếp tục được giữ lại trong bank để tái dùng.',
        output: 'Ngân hàng ngày càng chất lượng hơn sau mỗi vòng thi thật.',
    },
];

const BANK_RULES = [
    'Không sync mọi đề nháp vào ngân hàng. Chỉ sync đề đã rà sạch.',
    'Chapter phải thống nhất tên gọi. Đừng để lúc thì “Ham so”, lúc thì “Khảo sát hàm số”, lúc thì “Chuong 1”.',
    'Độ khó phải được gán theo cùng một chuẩn giữa các giáo viên.',
    'Ngân hàng hệ thống chỉ nên chứa câu chuẩn hóa đã qua admin review.',
    'sharedExams dùng cho bộ đề thành phẩm; bankItems dùng cho câu rời.',
    'Sau mỗi đợt thi, nên quay lại kết quả để biết câu nào nên giữ, sửa hoặc loại khỏi bank.',
];

const ESSAY_WORKFLOW = [
    {
        title: 'Học sinh gõ trực tiếp trên máy',
        icon: 'keyboard',
        summary: 'Phù hợp cho câu trả lời ngắn, giải thích ngắn hoặc bài có thể nhập trên bàn phím.',
        points: [
            'Trong câu tự luận, học sinh gõ bài vào ô Bài làm tự luận.',
            'Nếu là môn Toán, học sinh có thể mở bảng Công thức để chèn LaTeX cơ bản.',
            'Phần này được in kèm trong PDF đề + bài làm để giáo viên tự chấm ngoài hệ thống.',
        ],
    },
    {
        title: 'Học sinh viết tay rồi chụp ảnh nộp',
        icon: 'camera',
        summary: 'Dùng cho Toán tự luận dài, hình học, trình bày nhiều bước hoặc môn cần chữ viết tay.',
        points: [
            'Học sinh bấm Chụp ảnh hoặc Tải ảnh ngay trong câu tự luận.',
            'Ảnh được nén trước khi gửi, giới hạn số lượng để tránh đội chi phí lưu trữ.',
            'Nếu học sinh tải lại trang trước khi nộp, cần chọn lại ảnh vì hệ thống chỉ lưu tạm phần chữ trong lúc làm bài.',
        ],
    },
    {
        title: 'Giáo viên xuất PDF để tự chấm',
        icon: 'file-earmark-pdf',
        summary: 'Hệ thống không cộng lại điểm tự luận vào session. Giáo viên xuất trọn đề + bài làm rồi tự chấm, tự cộng ngoài hệ thống.',
        points: [
            'Vào trang Kết quả đề thi và bấm Xuất PDF đề + bài làm.',
            'PDF được gom theo từng học sinh, không tách mỗi câu một trang.',
            'Mỗi bài in đủ đề, đáp án học sinh đã chọn, phần tự luận gõ text, ảnh bài làm và ô trống để giáo viên ghi điểm.',
        ],
    },
    {
        title: 'Lưu trữ có hạn và tự dọn sau 3 năm',
        icon: 'clock-history',
        summary: 'Đây là chốt chặn chi phí quan trọng của hệ thống.',
        points: [
            'Ảnh bài làm tự luận không được giữ vĩnh viễn.',
            'Toàn bộ sessions cũ hơn 3 năm sẽ bị xóa định kỳ, kèm các ảnh bài làm đã nộp.',
            'Nếu nhà trường cần lưu hồ sơ lâu hơn, giáo viên nên xuất PDF và lưu về kho riêng của đơn vị.',
        ],
    },
];

const ESSAY_CHECKLIST = [
    'Khi tạo đề, dùng loại câu Tự luận cho câu cần chấm tay hoặc cần nộp ảnh bài làm.',
    'Trong ô Hướng dẫn chấm / đáp án gợi ý, nên ghi thang ý để PDF xuất ra đủ căn cứ chấm.',
    'Trước khi phát đề thật, nên làm thử 1 lượt bằng điện thoại để kiểm tra camera, ảnh, công thức và tốc độ mạng.',
    'Nếu bài thiên về viết tay, hãy nhắc học sinh chụp theo thứ tự trang và ảnh phải đủ sáng.',
    'Sau khi chấm xong, PDF đã xuất nên được lưu về máy/trường nếu cần lưu quá 3 năm.',
];

const DECISION_CARDS = [
    {
        title: 'Dùng đề cố định',
        icon: 'pin-angle',
        fit: 'Khi giáo viên mới bắt đầu hoặc cần một đề kiểm tra ổn định, dễ kiểm soát.',
        route: '/teacher/upload',
        label: 'Bắt đầu soạn đề',
    },
    {
        title: 'Dùng ngân hàng + ma trận',
        icon: 'diagram-3',
        fit: 'Khi ngân hàng đã có chapter, độ khó và loại câu đủ sạch để sinh đề lặp lại.',
        route: '/teacher/bank',
        label: 'Mở ngân hàng câu',
    },
    {
        title: 'Dùng thư viện đề',
        icon: 'collection-play',
        fit: 'Khi muốn giáo viên khác lấy một bộ đề hoàn chỉnh về dùng nhanh.',
        route: '/teacher',
        label: 'Về dashboard',
    },
    {
        title: 'Dùng live / trình chiếu',
        icon: 'easel2',
        fit: 'Khi muốn biến cùng một đề thành công cụ dạy học, chữa bài hoặc game lớp.',
        route: '/teacher/studio',
        label: 'Mở Teaching Studio',
    },
];

const COMMON_MISTAKES = [
    {
        title: 'Nhảy vào xây bank quá sớm',
        detail: 'Nếu đề nguồn còn bẩn, ngân hàng sẽ bẩn nhanh hơn rất nhiều vì lỗi được nhân bản sang nhiều đề mới.',
    },
    {
        title: 'Nhầm ngân hàng với thư viện',
        detail: 'Ngân hàng là kho câu hỏi rời; thư viện là kho đề hoàn chỉnh. Hai thứ phục vụ hai mục tiêu khác nhau.',
    },
    {
        title: 'Không nhìn lại kết quả sau khi thi',
        detail: 'Muốn bank tốt dần thì phải dùng dữ liệu thi thật để biết câu nào tốt, câu nào nhiễu kém hoặc quá mơ hồ.',
    },
    {
        title: 'Xuất bản system bank quá rộng',
        detail: 'Super admin chỉ nên đẩy lên system bank phần nội dung đã được chuẩn hóa, tránh biến kho hệ thống thành nơi chứa mọi bản nháp của giáo viên.',
    },
];

const QUICK_LINKS = [
    { to: '/teacher/upload', icon: 'upload', label: 'Tạo đề đầu tiên', note: 'Bắt đầu từ đề nguồn' },
    { to: '/teacher/bank', icon: 'database', label: 'Vào ngân hàng câu', note: 'Gắn chapter, difficulty, tạo đề từ bank' },
    { to: '/teacher/studio', icon: 'joystick', label: 'Mở Teaching Studio', note: 'Live, game, chữa bài, playbook' },
    { to: '/teacher', icon: 'grid', label: 'Về Dashboard', note: 'Xem kho đề, thư viện, hướng dẫn, học sinh' },
];

export default function TeacherGuidePage() {
    const { userProfile } = useAuth();
    const isAdminView = userProfile?.role === 'admin';

    return (
        <div className="teacher-guide-page">
            <section className="teacher-guide-hero card">
                <div className="teacher-guide-hero-grid">
                    <div>
                        <div className="teacher-guide-kicker">Playbook vận hành cho giáo viên</div>
                        <h1>HDSD từ số 0 đến xây ngân hàng bài bản</h1>
                        <p>
                            Trang này không viết kiểu lý thuyết chung. Nó đi thẳng theo đúng cấu trúc hiện tại của Thi Online:
                            tạo đề nguồn, sync bank, phát đề, live, trình chiếu và xem kết quả để làm bank ngày càng tốt hơn.
                        </p>
                        <div className="teacher-guide-hero-actions">
                            <Link to="/teacher/upload" className="btn btn-primary">
                                <i className="bi bi-upload"></i> Bắt đầu tạo đề
                            </Link>
                            <Link to="/teacher/bank" className="btn btn-outline">
                                <i className="bi bi-database"></i> Mở ngân hàng câu
                            </Link>
                        </div>
                    </div>

                    <div className="teacher-guide-hero-panel">
                        <div className="teacher-guide-mini-card">
                            <span>Đối tượng</span>
                            <strong>Giáo viên mới, giáo viên đang gom bank, super admin training giáo viên</strong>
                        </div>
                        <div className="teacher-guide-mini-card">
                            <span>Tư duy đúng</span>
                            <strong>Đề nguồn sạch trước, ngân hàng sau</strong>
                        </div>
                        <div className="teacher-guide-mini-card">
                            <span>Quyền hiện tại</span>
                            <strong>{isAdminView ? 'Bạn đang xem bằng quyền Super Admin' : 'Bạn đang xem bằng quyền Giáo viên'}</strong>
                        </div>
                    </div>
                </div>
            </section>

            <section className="teacher-guide-section">
                <div className="teacher-guide-section-head">
                    <div>
                        <span className="teacher-guide-kicker">Bản đồ hệ thống</span>
                        <h2>4 khối phải hiểu trước khi xây ngân hàng</h2>
                    </div>
                </div>

                <div className="teacher-guide-pillar-grid">
                    {SYSTEM_BLOCKS.map((block) => (
                        <article key={block.title} className={`teacher-guide-card tone-${block.tone}`}>
                            <div className="teacher-guide-card-head">
                                <span className="teacher-guide-icon"><i className={`bi bi-${block.icon}`}></i></span>
                                <h3>{block.title}</h3>
                            </div>
                            <p>{block.summary}</p>
                            <ul className="teacher-guide-list">
                                {block.points.map((point) => <li key={point}>{point}</li>)}
                            </ul>
                        </article>
                    ))}
                </div>
            </section>

            <section className="teacher-guide-section">
                <div className="teacher-guide-section-head">
                    <div>
                        <span className="teacher-guide-kicker">Lộ trình 0 → 1 → n</span>
                        <h2>Từ chưa có gì đến ngân hàng chạy được</h2>
                    </div>
                </div>

                <div className="teacher-guide-roadmap">
                    {ROADMAP.map((phase) => (
                        <article key={phase.step} className="teacher-guide-roadmap-item">
                            <div className="teacher-guide-roadmap-badge">{phase.step}</div>
                            <div className="teacher-guide-roadmap-body">
                                <h3>{phase.title}</h3>
                                <p>{phase.copy}</p>
                                <ul className="teacher-guide-list ordered-look">
                                    {phase.tasks.map((task) => <li key={task}>{task}</li>)}
                                </ul>
                            </div>
                        </article>
                    ))}
                </div>
            </section>

            <section className="teacher-guide-section">
                <div className="teacher-guide-section-head">
                    <div>
                        <span className="teacher-guide-kicker">Ví dụ thật</span>
                        <h2>Luồng nghiệp vụ từng bước: soạn đề → sync bank → mở thi → xem kết quả</h2>
                    </div>
                </div>

                <div className="teacher-guide-timeline">
                    {REAL_WORKFLOW.map((step) => (
                        <article key={step.index} className="teacher-guide-timeline-item">
                            <div className="teacher-guide-timeline-index">{step.index}</div>
                            <div className="teacher-guide-timeline-body">
                                <div className="teacher-guide-timeline-top">
                                    <h3>{step.title}</h3>
                                    <span>{step.where}</span>
                                </div>
                                <p><strong>Việc làm:</strong> {step.action}</p>
                                <div className="teacher-guide-output-box">
                                    <strong>Kết quả tạo ra:</strong> {step.output}
                                </div>
                            </div>
                        </article>
                    ))}
                </div>
            </section>

            <section className="teacher-guide-section split">
                <div className="teacher-guide-section-block">
                    <div className="teacher-guide-section-head">
                        <div>
                            <span className="teacher-guide-kicker">Chuẩn hóa ngân hàng</span>
                            <h2>6 nguyên tắc để bank dùng được lâu dài</h2>
                        </div>
                    </div>
                    <div className="teacher-guide-checklist">
                        {BANK_RULES.map((rule) => (
                            <div key={rule} className="teacher-guide-check-item">
                                <i className="bi bi-check2-circle"></i>
                                <span>{rule}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="teacher-guide-section-block">
                    <div className="teacher-guide-section-head">
                        <div>
                            <span className="teacher-guide-kicker">Chọn đúng công cụ</span>
                            <h2>Khi nào nên dùng gì</h2>
                        </div>
                    </div>
                    <div className="teacher-guide-decision-grid">
                        {DECISION_CARDS.map((card) => (
                            <article key={card.title} className="teacher-guide-card compact">
                                <div className="teacher-guide-card-head compact">
                                    <span className="teacher-guide-icon"><i className={`bi bi-${card.icon}`}></i></span>
                                    <h3>{card.title}</h3>
                                </div>
                                <p>{card.fit}</p>
                                <Link to={card.route} className="teacher-guide-inline-link">
                                    {card.label} <i className="bi bi-arrow-right"></i>
                                </Link>
                            </article>
                        ))}
                    </div>
                </div>
            </section>

            <section className="teacher-guide-section split">
                <div className="teacher-guide-section-block">
                    <div className="teacher-guide-section-head">
                        <div>
                            <span className="teacher-guide-kicker">Quy trình tự luận</span>
                            <h2>Dùng text + công thức + ảnh sao cho không rối</h2>
                        </div>
                    </div>

                    <div className="teacher-guide-pillar-grid">
                        {ESSAY_WORKFLOW.map((item) => (
                            <article key={item.title} className="teacher-guide-card compact">
                                <div className="teacher-guide-card-head compact">
                                    <span className="teacher-guide-icon"><i className={`bi bi-${item.icon}`}></i></span>
                                    <h3>{item.title}</h3>
                                </div>
                                <p>{item.summary}</p>
                                <ul className="teacher-guide-list">
                                    {item.points.map((point) => <li key={point}>{point}</li>)}
                                </ul>
                            </article>
                        ))}
                    </div>
                </div>

                <div className="teacher-guide-section-block">
                    <div className="teacher-guide-section-head">
                        <div>
                            <span className="teacher-guide-kicker">Checklist phát đề tự luận</span>
                            <h2>5 việc nên làm trước khi dùng thật</h2>
                        </div>
                    </div>

                    <div className="teacher-guide-checklist">
                        {ESSAY_CHECKLIST.map((item) => (
                            <div key={item} className="teacher-guide-check-item">
                                <i className="bi bi-check2-circle"></i>
                                <span>{item}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="teacher-guide-section">
                <div className="teacher-guide-section-head">
                    <div>
                        <span className="teacher-guide-kicker">Những chỗ dễ sai</span>
                        <h2>4 lỗi làm hệ thống rối lên rất nhanh</h2>
                    </div>
                </div>

                <div className="teacher-guide-mistake-grid">
                    {COMMON_MISTAKES.map((item) => (
                        <article key={item.title} className="teacher-guide-card warning">
                            <div className="teacher-guide-card-head compact">
                                <span className="teacher-guide-icon"><i className="bi bi-exclamation-triangle"></i></span>
                                <h3>{item.title}</h3>
                            </div>
                            <p>{item.detail}</p>
                        </article>
                    ))}
                </div>
            </section>

            <section className="teacher-guide-section">
                <div className="teacher-guide-section-head">
                    <div>
                        <span className="teacher-guide-kicker">Mở nhanh các điểm vào</span>
                        <h2>Đi thẳng đến đúng chỗ thao tác</h2>
                    </div>
                </div>

                <div className="teacher-guide-quicklinks">
                    {QUICK_LINKS.map((item) => (
                        <Link key={item.to} to={item.to} className="teacher-guide-quicklink-card">
                            <span className="teacher-guide-icon"><i className={`bi bi-${item.icon}`}></i></span>
                            <strong>{item.label}</strong>
                            <span>{item.note}</span>
                        </Link>
                    ))}
                </div>
            </section>
        </div>
    );
}