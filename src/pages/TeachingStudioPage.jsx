import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import AISettingsPanel from '../components/AISettingsPanel';
import { useAuth } from '../contexts/AuthContext';

const STUDIO_CLUSTERS = [
    {
        id: 'games',
        kicker: 'Cụm 01',
        title: 'Games và live classroom',
        icon: 'controller',
        status: 'live',
        statusLabel: 'Dùng ngay',
        summary: 'Biến đề thi hiện có thành mini-game trên lớp với phòng live, bảng xếp hạng và nhiều mode hoạt động.',
        features: ['Classic live', 'Rung chuông vàng', 'Đua tốc độ', 'Ai là triệu phú', 'Presentation mode'],
        primary: { to: '/teacher', label: 'Chọn đề để phát live' },
        secondary: { to: '/teacher/upload', label: 'Tạo game mới' },
    },
    {
        id: 'toolkit',
        kicker: 'Cụm 02',
        title: 'Teaching toolkit',
        icon: 'tools',
        status: 'live',
        statusLabel: 'Đang vận hành',
        summary: 'Dùng một kho công cụ để tạo worksheet, bộ câu, đề ôn, đề kiểm tra và các phiên bản dạy học khác nhau từ cùng một nội dung gốc.',
        features: ['Nhập DOCX/TXT/XLSX/TEX', 'Chỉnh sửa từng câu', 'Section theo passage', 'Asset storage'],
        primary: { to: '/teacher/upload', label: 'Mở xưởng chế tác' },
        secondary: { to: '/teacher/bank', label: 'Mở ngân hàng câu' },
    },
    {
        id: 'lab',
        kicker: 'Cụm 03',
        title: 'Smart content lab',
        icon: 'cpu',
        status: 'hybrid',
        statusLabel: 'Nền tảng đã sẵn',
        summary: 'Dùng AI BYOK để viết lại, remix, tạo câu mới và nâng chất lượng nội dung mà không khóa chặt vào một provider duy nhất.',
        features: ['Gemini / Groq / DeepSeek', 'Chỉ lưu key trên máy', 'Budget guard', 'Prompt theo dạng câu hỏi'],
        primary: { anchor: '#studio-ai-lab', label: 'Mở AI Content Lab' },
        secondary: { to: '/teacher/upload', label: 'Soạn với AI' },
    },
    {
        id: 'vault',
        kicker: 'Cụm 04',
        title: 'Template vault',
        icon: 'collection',
        status: 'live',
        statusLabel: 'Có sẵn thư viện',
        summary: 'Nhập đề mẫu, thư viện dùng chung và đề hệ thống vào tài khoản riêng để biến nó thành game, worksheet hoặc bài tập cho lớp.',
        features: ['Built-in sample exams', 'Shared library', 'Package-aware access', 'Import thành bản nháp'],
        primary: { to: '/teacher', label: 'Mở kho đề và thư viện' },
        secondary: { to: '/teacher/bank', label: 'Tái sử dụng từ bank' },
    },
];

const STUDIO_BLUEPRINT = [
    {
        step: '01',
        title: 'Lập nội dung gốc',
        copy: 'Nhập file, soạn thủ công hoặc lấy đề mẫu để có một nguồn nội dung sạch và dễ quản lý.',
        action: { to: '/teacher/upload', label: 'Tạo hoạt động mới' },
    },
    {
        step: '02',
        title: 'Đóng gói thành công cụ dạy học',
        copy: 'Bạn có thể dùng lại trong kho đề, ngân hàng câu, thư viện dùng chung hoặc AI lab tùy cách vận hành.',
        action: { to: '/teacher/bank', label: 'Mở question forge' },
    },
    {
        step: '03',
        title: 'Phát cho lớp đúng ngữ cảnh',
        copy: 'Dạy trên lớp bằng live game, giao bài từ xa bằng portal lớp, hoặc giữ dạng đề kiểm tra truyền thống.',
        action: { to: '/teacher', label: 'Về command center' },
    },
];

const STUDIO_MILLIONAIRE_PACK = [
    {
        id: 'txt',
        title: 'File mẫu TXT',
        icon: 'filetype-txt',
        href: '/templates/millionaire/millionaire-live-template.txt',
        note: '12 câu MCQ import được ngay, hợp với lifeline millionaire.',
    },
    {
        id: 'json',
        title: 'File mẫu JSON',
        icon: 'filetype-json',
        href: '/templates/millionaire/millionaire-live-template.json',
        note: 'Đầu vào chuẩn cho hệ thống ngoài, script sinh đề hoặc AI pipeline.',
    },
    {
        id: 'guide',
        title: 'HDSD chi tiết',
        icon: 'journal-richtext',
        href: '/templates/millionaire/huong-dan-ai-la-trieu-phu.html',
        note: 'Quy trình soạn đề, ready check, launch live và lỗi thường gặp.',
    },
    {
        id: 'prompts',
        title: 'Mẫu câu gợi ý',
        icon: 'file-earmark-text',
        href: '/templates/millionaire/millionaire-mau-cau-goi-y.md',
        note: 'Mẫu stem, distractor và lời dẫn gameshow để sửa nhanh.',
    },
];

const MILLIONAIRE_TYPING_RULES = [
    'Nên dùng 10-15 câu nếu muốn ladder, pace và BXH hiện rõ.',
    'Muốn dùng trọn bộ 50/50, hỏi khán giả và chuyên gia cho cả trận: ưu tiên 100% câu MCQ.',
    'MCQ phải viết đúng chuẩn A. B. C. D. và có dòng Đáp án: X nếu không gạch chân trong DOCX.',
    'Nếu trộn short answer vào millionaire, lifeline sẽ tự động khóa ở câu đó để tránh gây nhầm.',
];

const STUDIO_GAME_LIBRARY = [
    {
        id: 'millionaire',
        kicker: 'Flagship live',
        title: 'Ai là triệu phú',
        icon: 'trophy-fill',
        status: 'live',
        statusLabel: 'Dùng ngay',
        objective: 'Tổng kết chủ đề, review sự kiện, tiết học cần cao trào.',
        engine: 'Live mode: millionaire',
        format: 'MCQ 100% · 10-15 câu · ready check + award stage',
        note: 'Mode gameshow đầy đủ nhất hiện tại: có lifeline, BXH realtime, mốc an toàn và màn trao giải top 3.',
        tags: ['Ready check', 'Lifeline', 'Top 3', 'Award stage'],
        action: { href: '/templates/millionaire/huong-dan-ai-la-trieu-phu.html', label: 'Mở starter pack' },
    },
    {
        id: 'golden-bell',
        kicker: 'Loại trực tiếp',
        title: 'Rung chuông vàng',
        icon: 'bell-fill',
        status: 'live',
        statusLabel: 'Dùng ngay',
        objective: 'Ôn thi, chung kết chủ đề, tiết học cần phân hóa rõ.',
        engine: 'Live mode: golden_bell',
        format: 'MCQ/TF ngắn · sai là bị loại',
        note: 'Hợp khi muốn giữ cao áp lực thi đua, lọc nhanh nhóm vững kiến thức và tạo hiệu ứng thi đấu cả lớp.',
        tags: ['Loại trực tiếp', 'Chung kết', 'Ôn thi'],
        action: { to: '/teacher', label: 'Mở live launcher' },
    },
    {
        id: 'speed',
        kicker: 'Phản xạ nhanh',
        title: 'Đua tốc độ',
        icon: 'lightning-charge-fill',
        status: 'live',
        statusLabel: 'Dùng ngay',
        objective: 'Warm-up đầu giờ, speed drill, gợi nhớ nhanh công thức / từ vựng.',
        engine: 'Live mode: speed',
        format: 'MCQ ngắn · 10-15 giây/câu · ưu tiên stem ngắn',
        note: 'Hợp cho tiết cần nhiệt, cần pace nhanh và cần thu được dữ liệu xem ai vừa đúng vừa nhanh.',
        tags: ['Warm-up', 'Speed drill', 'Từ vựng'],
        action: { to: '/teacher', label: 'Mở live launcher' },
    },
    {
        id: 'classic',
        kicker: 'Cân bằng nhất',
        title: 'Classic live quiz',
        icon: 'play-circle-fill',
        status: 'live',
        statusLabel: 'Dùng ngay',
        objective: 'Kiểm tra nhanh toàn lớp, checkpoint giữa bài, exit ticket cuối tiết.',
        engine: 'Live mode: classic',
        format: 'MCQ + TF + short answer · 5-12 câu',
        note: 'Mode dễ dùng nhất cho đa số tình huống dạy học vì cân bằng giữa tốc độ, điểm số và mức độ linh hoạt câu hỏi.',
        tags: ['Checkpoint', 'Exit ticket', 'Đa dạng dạng câu'],
        action: { to: '/teacher', label: 'Mở live launcher' },
    },
    {
        id: 'presentation',
        kicker: 'Debrief mode',
        title: 'Trình chiếu / chữa bài',
        icon: 'easel2-fill',
        status: 'live',
        statusLabel: 'Dùng ngay',
        objective: 'Giải đề, chữa bài, phân tích lời giải và dẫn dắt thảo luận.',
        engine: 'Live mode: presentation',
        format: 'Không chấm điểm · mọi dạng câu hỏi',
        note: 'Dùng khi giáo viên muốn giữ toàn quyền điều tiết, hiện từng câu và thảo luận lời giải mà không tạo áp lực xếp hạng.',
        tags: ['Debrief', 'Giải đề', 'Dẫn dắt thảo luận'],
        action: { to: '/teacher', label: 'Mở live launcher' },
    },
    {
        id: 'clue-hunt',
        kicker: 'Blueprint',
        title: 'Truy tìm manh mối',
        icon: 'search-heart-fill',
        status: 'blueprint',
        statusLabel: 'Playbook',
        objective: 'Đọc hiểu, Lịch sử, STEM, bài học cần gom clue theo trạm.',
        engine: 'Build trên section + passage + presentation/live',
        format: '3-5 cụm clue · có nhóm · debrief cuối',
        note: 'Không cần engine mới ngay lập tức: có thể dùng section, passage và live/presentation để tạo một tiết truy tìm manh mối có nhóm.',
        tags: ['Passage', 'Nhóm', 'Project-based'],
        action: { href: '/templates/games/thu-vien-game-giao-duc.html', label: 'Xem playbook' },
    },
    {
        id: 'bingo-vocab',
        kicker: 'Blueprint',
        title: 'Bingo từ vựng / khái niệm',
        icon: 'grid-3x3-gap-fill',
        status: 'blueprint',
        statusLabel: 'Playbook',
        objective: 'Tiếng Anh, khoa học, lịch sử: gọi nhanh khái niệm cần nhớ.',
        engine: 'Build trên bank + worksheet + live classic/speed',
        format: 'Bảng từ khóa + gọi cue theo đợt',
        note: 'Hợp để biến nội dung cần học thuộc thành một trò nhẹ, đặc biệt với từ vựng, định nghĩa và cặp đôi khái niệm.',
        tags: ['Từ vựng', 'Khái niệm', 'Worksheet'],
        action: { href: '/templates/games/thu-vien-game-giao-duc.html', label: 'Xem playbook' },
    },
    {
        id: 'debate-arena',
        kicker: 'Blueprint',
        title: 'Đối đầu lập luận',
        icon: 'chat-square-quote-fill',
        status: 'blueprint',
        statusLabel: 'Playbook',
        objective: 'Ngữ văn, GDCD, social studies và bài học cần tranh biện ngắn.',
        engine: 'Build trên presentation + rubric + portal lớp',
        format: 'Cặp đôi / nhóm nhỏ · rubric chấm nhanh',
        note: 'Phù hợp khi muốn chuyển từ trả lời đúng/sai sang lý giải, bảo vệ quan điểm và phản biện ngắn trong lớp.',
        tags: ['Phản biện', 'Rubric', 'Discussion'],
        action: { href: '/templates/games/thu-vien-game-giao-duc.html', label: 'Xem playbook' },
    },
];

const STUDIO_OBJECTIVE_MATRIX = [
    {
        id: 'warmup',
        icon: 'rocket-takeoff-fill',
        goal: 'Khởi động đầu giờ',
        recommendation: 'Đua tốc độ hoặc Classic live',
        structure: '5-8 câu MCQ ngắn, stem rất gọn.',
        reason: 'Kéo năng lượng lớp trong 5-7 phút mà vẫn thu được dữ liệu xem lớp đang nóng máy đến đâu.',
    },
    {
        id: 'checkpoint',
        icon: 'clipboard2-pulse-fill',
        goal: 'Checkpoint giữa bài',
        recommendation: 'Classic live',
        structure: '6-10 câu, trộn MCQ/TF/short answer.',
        reason: 'Đây là mode cân bằng nhất khi cần biết cả lớp đang vướng ở khái niệm nào trước khi đi tiếp.',
    },
    {
        id: 'exam-prep',
        icon: 'bell-fill',
        goal: 'Ôn thi và phân hóa',
        recommendation: 'Rung chuông vàng hoặc Ai là triệu phú',
        structure: '10-15 câu tăng độ khó dần.',
        reason: 'Hợp khi muốn có áp lực thi đua rõ, nhìn thấy nhóm học sinh giữ được phong độ đến cuối.',
    },
    {
        id: 'debrief',
        icon: 'easel2-fill',
        goal: 'Chữa bài và debrief',
        recommendation: 'Presentation mode',
        structure: 'Mọi dạng câu hỏi, ưu tiên câu có lời giải.',
        reason: 'Giáo viên giữ nhịp toàn bộ tiết học, không để điểm số làm hụt thảo luận.',
    },
    {
        id: 'project',
        icon: 'search-heart-fill',
        goal: 'Làm việc nhóm / dự án',
        recommendation: 'Truy tìm manh mối, bingo, trạm hoạt động',
        structure: '3-5 cụm clue hoặc bảng keyword.',
        reason: 'Khi mục tiêu là khai thác passage, ngữ cảnh, lập luận và hợp tác thì nên dùng playbook nhóm thay vì chỉ thi cá nhân.',
    },
    {
        id: 'event',
        icon: 'stars',
        goal: 'Tiết tổng kết / sự kiện học tập',
        recommendation: 'Ai là triệu phú',
        structure: '12 câu, ready check, award stage cuối trận.',
        reason: 'Mode này tạo đủ cao trào, dễ chụp màn hình tổng kết, trao thưởng và đóng kết chủ đề một cách có nghi thức.',
    },
];

const STUDIO_GAME_RESOURCES = [
    {
        id: 'library',
        title: 'Thư viện game giáo dục',
        icon: 'controller',
        href: '/templates/games/thu-vien-game-giao-duc.html',
        note: 'Map 12 format game giáo dục vào mục tiêu dạy học, số học sinh và engine hiện có.',
    },
    {
        id: 'playbook',
        title: 'Mẫu playbook giáo viên',
        icon: 'clipboard2-check',
        href: '/templates/games/mau-playbook-game-giao-duc.md',
        note: 'Form 1 trang để chốt mục tiêu, pacing, scoring, thông điệp mở màn và cách debrief.',
    },
];

export default function TeachingStudioPage() {
    const { user, userProfile } = useAuth();
    const [copyState, setCopyState] = useState('idle');

    const isAdminView = userProfile?.role === 'admin';
    const slug = isAdminView ? null : userProfile?.teacherSlug;
    const portalUrl = slug ? `${window.location.origin}/t/${slug}` : null;
    const displayName = userProfile?.displayName || (isAdminView ? 'super admin' : 'giáo viên');
    const studioHeroBadge = 'Trung tâm dạy học, live class và thư viện';
    const studioHeroDescription = isAdminView
        ? 'Không gian để rà nội dung, tổ chức hoạt động dạy học và giữ trải nghiệm giáo viên gọn, rõ, dùng được ngay.'
        : 'Nơi giáo viên mở nhanh đúng công cụ cho từng nhu cầu: soạn bài, phát live, chữa bài, dùng ngân hàng câu và tái sử dụng thư viện có sẵn.';
    const studioHeroMetrics = [
        { label: 'Dùng nhanh', value: '1 nơi', hint: 'Mở đúng công cụ trong vài giây' },
        { label: 'Hoạt động chính', value: '4 nhóm', hint: 'Live, toolkit, AI lab, thư viện' },
        { label: 'Phù hợp cho', value: 'Mỗi tiết dạy', hint: 'Từ khởi động đến chữa bài' },
    ];
    const studioFocusCard = {
        kicker: 'Gợi ý bắt đầu',
        title: 'Chọn đúng format cho đúng mục tiêu tiết học',
        description: 'Khởi động nhanh bằng live game, giao nhiệm vụ bằng portal lớp, hoặc dùng presentation để chữa bài và dẫn thảo luận có kiểm soát.',
    };

    const quickActions = [
        {
            id: 'builder',
            title: 'Activity builder',
            icon: 'plus-square',
            copy: 'Nhập file, chia section và tạo một activity mới từ đầu.',
            to: '/teacher/upload',
        },
        {
            id: 'forge',
            title: 'Question forge',
            icon: 'database-gear',
            copy: 'Gom, lọc và tái sử dụng câu hỏi nhanh để biến thành bộ bài dạy học.',
            to: '/teacher/bank',
        },
        {
            id: 'live',
            title: 'Live quiz launch',
            icon: 'broadcast',
            copy: 'Chọn một đề trong kho rồi phát live classroom từ exam detail.',
            to: '/teacher',
        },
        portalUrl
            ? {
                id: 'portal',
                title: 'Portal lớp riêng',
                icon: 'link-45deg',
                copy: `Portal hiện tại: /t/${slug}`,
                href: portalUrl,
            }
            : {
                id: 'portal-setup',
                title: 'Thiết lập portal lớp',
                icon: 'person-workspace',
                copy: 'Cấp teacher slug trong dashboard để có link lớp riêng cho học sinh.',
                to: '/teacher',
            },
    ];

    const handleCopyPortal = async () => {
        if (!portalUrl) return;
        try {
            await navigator.clipboard.writeText(portalUrl);
            setCopyState('copied');
            window.setTimeout(() => setCopyState('idle'), 2200);
        } catch (error) {
            console.error('copy portal failed', error);
            setCopyState('failed');
            window.setTimeout(() => setCopyState('idle'), 2200);
        }
    };

    return (
        <div className="studio-page">
            <section className="studio-hero">
                <div className="studio-hero-main">
                    <div className="studio-hero-topline">
                        <span className="studio-hero-kicker">TEACHING STUDIO V1</span>
                        <span className="studio-hero-badge"><i className="bi bi-layers"></i> {studioHeroBadge}</span>
                    </div>
                    <h1>{isAdminView ? 'Studio nội dung và dạy học' : `Studio dạy học của ${displayName}`}</h1>
                    <p>{studioHeroDescription}</p>

                    <div className="studio-hero-metrics">
                        {studioHeroMetrics.map((item) => (
                            <div key={item.label}>
                                <span>{item.label}</span>
                                <strong>{item.value}</strong>
                                <small>{item.hint}</small>
                            </div>
                        ))}
                    </div>

                    <div className="studio-hero-actions">
                        <Link to="/teacher/upload" className="btn btn-primary">
                            <i className="bi bi-plus-circle"></i> Tạo activity mới
                        </Link>
                        <Link to="/teacher" className="btn btn-outline studio-hero-outline-btn">
                            <i className="bi bi-broadcast"></i> Chọn đề để phát live
                        </Link>
                        <Link to="/teacher/bank" className="btn btn-outline studio-hero-outline-btn">
                            <i className="bi bi-database"></i> Mở question forge
                        </Link>
                        {portalUrl && (
                            <button type="button" className="btn btn-outline studio-hero-outline-btn" onClick={handleCopyPortal}>
                                <i className="bi bi-clipboard"></i> Copy link lớp
                            </button>
                        )}
                    </div>

                    {copyState !== 'idle' && (
                        <div className={`studio-copy-state ${copyState}`}>
                            <i className={`bi bi-${copyState === 'copied' ? 'check2-circle' : 'exclamation-circle'}`}></i>
                            {copyState === 'copied' ? 'Đã copy link portal lớp.' : 'Không copy được link portal trên trình duyệt hiện tại.'}
                        </div>
                    )}
                </div>

                <div className="studio-hero-side">
                    <div className="studio-hero-side-card emphasis">
                        <span className="studio-side-kicker">{studioFocusCard.kicker}</span>
                        <h3>{studioFocusCard.title}</h3>
                        <p>{studioFocusCard.description}</p>
                    </div>

                    <div className="studio-hero-side-card">
                        <span className="studio-side-kicker">Trạng thái lớp học</span>
                        <div className="studio-side-list">
                            <div>
                                <strong>{userProfile?.schoolName || 'Chưa cập nhật trường lớp'}</strong>
                                <span>Không gian vận hành hiện tại</span>
                            </div>
                            <div>
                                <strong>{portalUrl ? `/t/${slug}` : 'Chưa có teacher slug'}</strong>
                                <span>{portalUrl ? 'Portal lớp đang sẵn sàng' : 'Cần thiết lập portal trong dashboard'}</span>
                            </div>
                            <div>
                                <strong>{isAdminView ? 'Admin preview mode' : 'Teacher control mode'}</strong>
                                <span>{isAdminView ? 'Xem studio như một bộ khung hệ thống' : 'Dùng ngay như command center cho dạy học'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="studio-section">
                <div className="studio-section-head">
                    <div>
                        <span className="studio-section-kicker">4 khu vực chính</span>
                        <h2>Chọn nhanh khu vực phù hợp với việc bạn đang cần làm</h2>
                        <p>Mỗi khu vực phục vụ một kiểu thao tác khác nhau: phát live, chế tác nội dung, dùng AI hoặc tái sử dụng thư viện.</p>
                    </div>
                </div>

                <div className="studio-cluster-grid">
                    {STUDIO_CLUSTERS.map((cluster, index) => (
                        <motion.article
                            key={cluster.id}
                            className={`studio-cluster-card ${cluster.status}`}
                            initial={{ opacity: 0, y: 18 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.05 }}
                        >
                            <div className="studio-cluster-top">
                                <span className={`studio-status-badge ${cluster.status}`}>{cluster.statusLabel}</span>
                                <span className="studio-cluster-icon"><i className={`bi bi-${cluster.icon}`}></i></span>
                            </div>
                            <div className="studio-cluster-copy">
                                <div className="studio-cluster-kicker">{cluster.kicker}</div>
                                <h3>{cluster.title}</h3>
                                <p>{cluster.summary}</p>
                            </div>
                            <div className="studio-feature-row">
                                {cluster.features.map((feature) => (
                                    <span key={feature} className="studio-feature-chip">{feature}</span>
                                ))}
                            </div>
                            <div className="studio-card-actions">
                                {'to' in cluster.primary ? (
                                    <Link to={cluster.primary.to} className="studio-link-chip primary">
                                        <i className="bi bi-arrow-right-circle"></i> {cluster.primary.label}
                                    </Link>
                                ) : (
                                    <a href={cluster.primary.anchor} className="studio-link-chip primary">
                                        <i className="bi bi-arrow-down-circle"></i> {cluster.primary.label}
                                    </a>
                                )}
                                <Link to={cluster.secondary.to} className="studio-link-chip">
                                    <i className="bi bi-box-arrow-up-right"></i> {cluster.secondary.label}
                                </Link>
                            </div>
                        </motion.article>
                    ))}
                </div>
            </section>

            <section className="studio-section">
                <div className="studio-blueprint-grid">
                    <div className="studio-blueprint-card primary" style={{ gridColumn: '1 / -1' }}>
                        <div className="studio-section-head compact">
                            <div>
                                <span className="studio-section-kicker">Playbook</span>
                                <h2>3 bước gọn để dùng Studio hiệu quả</h2>
                            </div>
                        </div>
                        <div className="studio-blueprint-list">
                            {STUDIO_BLUEPRINT.map((item) => (
                                <div key={item.step} className="studio-blueprint-step">
                                    <span className="studio-step-number">{item.step}</span>
                                    <div>
                                        <strong>{item.title}</strong>
                                        <p>{item.copy}</p>
                                        <Link to={item.action.to} className="studio-inline-link">
                                            <i className="bi bi-arrow-right"></i> {item.action.label}
                                        </Link>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>
            </section>

            <section className="studio-section">
                <div className="studio-section-head">
                    <div>
                        <span className="studio-section-kicker">Mở nhanh hôm nay</span>
                        <h2>Các lựa chọn cần dùng ngay cho giáo viên</h2>
                        <p>Đi thẳng vào đúng công cụ thay vì phải nhớ nhiều đường dẫn hoặc thao tác vòng.</p>
                    </div>
                </div>

                <div className="studio-action-grid">
                    {quickActions.map((item) => (
                        <motion.article
                            key={item.id}
                            className="studio-action-card"
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.08 }}
                        >
                            <div className="studio-action-icon"><i className={`bi bi-${item.icon}`}></i></div>
                            <div className="studio-action-copy">
                                <h3>{item.title}</h3>
                                <p>{item.copy}</p>
                            </div>
                            {'href' in item ? (
                                <a href={item.href} target="_blank" rel="noreferrer" className="studio-link-chip primary">
                                    <i className="bi bi-box-arrow-up-right"></i> Mở ngay
                                </a>
                            ) : (
                                <Link to={item.to} className="studio-link-chip primary">
                                    <i className="bi bi-arrow-right-circle"></i> Mở ngay
                                </Link>
                            )}
                        </motion.article>
                    ))}
                </div>
            </section>

            <section className="studio-section" id="studio-game-library">
                <div className="studio-section-head">
                    <div>
                        <span className="studio-section-kicker">Game library</span>
                        <h2>Thư viện game giáo dục để xài được cho nhiều mục tiêu</h2>
                        <p>Không nên nghĩ Studio chỉ có một game. Đây là thư viện để giáo viên chọn đúng format cho warm-up, checkpoint, ôn thi, debrief, làm việc nhóm và tiết tổng kết.</p>
                    </div>
                </div>

                <div className="studio-game-grid">
                    {STUDIO_GAME_LIBRARY.map((game, index) => (
                        <motion.article
                            key={game.id}
                            className={`studio-game-card ${game.status}`}
                            initial={{ opacity: 0, y: 18 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.04 }}
                        >
                            <div className="studio-game-top">
                                <span className={`studio-status-badge ${game.status}`}>{game.statusLabel}</span>
                                <span className="studio-cluster-icon"><i className={`bi bi-${game.icon}`}></i></span>
                            </div>

                            <div className="studio-game-copy">
                                <div className="studio-cluster-kicker">{game.kicker}</div>
                                <h3>{game.title}</h3>
                                <p>{game.note}</p>
                            </div>

                            <div className="studio-game-meta">
                                <div>
                                    <span>Mục tiêu</span>
                                    <strong>{game.objective}</strong>
                                </div>
                                <div>
                                    <span>Engine</span>
                                    <strong>{game.engine}</strong>
                                </div>
                                <div>
                                    <span>Format</span>
                                    <strong>{game.format}</strong>
                                </div>
                            </div>

                            <div className="studio-feature-row">
                                {game.tags.map((tag) => (
                                    <span key={tag} className="studio-feature-chip">{tag}</span>
                                ))}
                            </div>

                            {'href' in game.action ? (
                                <a href={game.action.href} target="_blank" rel="noreferrer" className="studio-link-chip primary">
                                    <i className="bi bi-box-arrow-up-right"></i> {game.action.label}
                                </a>
                            ) : (
                                <Link to={game.action.to} className="studio-link-chip primary">
                                    <i className="bi bi-arrow-right-circle"></i> {game.action.label}
                                </Link>
                            )}
                        </motion.article>
                    ))}
                </div>
            </section>

            <section className="studio-section" id="studio-game-matrix">
                <div className="studio-section-head">
                    <div>
                        <span className="studio-section-kicker">Chọn đúng game</span>
                        <h2>Map mục tiêu dạy học vào game thay vì chọn theo cảm tính</h2>
                        <p>Giáo viên thường không thiếu đề, mà thiếu một bộ logic chọn đúng game. Bảng này dùng để chọn format theo mục tiêu sư phạm, quy mô lớp và pace của tiết học.</p>
                    </div>
                </div>

                <div className="studio-goal-grid">
                    {STUDIO_OBJECTIVE_MATRIX.map((item) => (
                        <div key={item.id} className="studio-goal-card">
                            <div className="studio-goal-icon"><i className={`bi bi-${item.icon}`}></i></div>
                            <strong>{item.goal}</strong>
                            <span>Đề xuất: {item.recommendation}</span>
                            <p>{item.structure}</p>
                            <small>{item.reason}</small>
                        </div>
                    ))}
                </div>
            </section>

            <section className="studio-section" id="studio-game-resources">
                <div className="studio-section-head">
                    <div>
                        <span className="studio-section-kicker">Playbook pack</span>
                        <h2>Bộ tài liệu để phát triển thêm nhiều game mà không bị vỡ hệ thống</h2>
                        <p>Nếu sau này muốn thêm 5-10 game nữa, cần có playbook chung để không game nào bị trở thành một feature độc lập khó vận hành. Hai file dưới đây là bộ nền cho việc mở rộng.</p>
                    </div>
                </div>

                <div className="studio-resource-grid">
                    {STUDIO_GAME_RESOURCES.map((item) => (
                        <a key={item.id} href={item.href} target="_blank" rel="noreferrer" className="studio-resource-card">
                            <div className="studio-action-icon"><i className={`bi bi-${item.icon}`}></i></div>
                            <div className="studio-action-copy">
                                <h3>{item.title}</h3>
                                <p>{item.note}</p>
                            </div>
                            <span className="studio-link-chip primary">
                                <i className="bi bi-box-arrow-up-right"></i> Mở file
                            </span>
                        </a>
                    ))}
                </div>
            </section>

            <section className="studio-section" id="studio-millionaire-pack">
                <div className="studio-section-head">
                    <div>
                        <span className="studio-section-kicker">Template pack</span>
                        <h2>Bộ mẫu và chuẩn gõ cho Ai là triệu phú</h2>
                        <p>Đây là bộ tài liệu để giáo viên có file mẫu kéo-thả ngay, biết rõ khi nào nên dùng MCQ 100%, và không cần đoán format khi soạn cho live mode.</p>
                    </div>
                </div>

                <div className="studio-template-grid">
                    {STUDIO_MILLIONAIRE_PACK.map((item) => (
                        <a key={item.id} href={item.href} target="_blank" rel="noreferrer" className="studio-template-card">
                            <div className="studio-action-icon"><i className={`bi bi-${item.icon}`}></i></div>
                            <div className="studio-action-copy">
                                <h3>{item.title}</h3>
                                <p>{item.note}</p>
                            </div>
                            <span className="studio-link-chip primary">
                                <i className="bi bi-box-arrow-up-right"></i> Mở file
                            </span>
                        </a>
                    ))}
                </div>

                <div className="studio-template-standard-card">
                    <div className="studio-section-head compact">
                        <div>
                            <span className="studio-section-kicker">Quy tắc soạn nhanh</span>
                            <h2>4 quy tắc để live millionaire chạy đẹp</h2>
                        </div>
                    </div>
                    <div className="studio-template-rule-grid">
                        {MILLIONAIRE_TYPING_RULES.map((rule) => (
                            <div key={rule} className="studio-template-rule-item">
                                <i className="bi bi-check2-circle"></i>
                                <span>{rule}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="studio-section" id="studio-ai-lab">
                <div className="studio-section-head">
                    <div>
                        <span className="studio-section-kicker">AI content lab</span>
                        <h2>Đặt cấu hình AI ngay trong Studio</h2>
                        <p>Phần này giữ đúng triết lý BYOK của hệ thống: key chỉ ở localStorage, giáo viên tự kiểm soát provider, model và ngân sách gọi.</p>
                    </div>
                </div>
                <AISettingsPanel
                    userId={user?.uid}
                    heading="AI Content Lab"
                    description="Bật provider, đặt trần usage và giữ toàn bộ API key ở trình duyệt hiện tại. Đây là tầng nền cho smart content generation trong Teaching Studio."
                />
            </section>
        </div>
    );
}