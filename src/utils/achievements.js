// Achievement definitions and logic

export const ACHIEVEMENTS = [
    {
        id: 'first_quiz',
        name: 'Bước Đầu',
        description: 'Hoàn thành bài thi đầu tiên',
        icon: '🎯',
        condition: (stats) => stats.totalQuizzes >= 1,
    },
    {
        id: 'five_quizzes',
        name: 'Chăm Chỉ',
        description: 'Hoàn thành 5 bài thi',
        icon: '📝',
        condition: (stats) => stats.totalQuizzes >= 5,
    },
    {
        id: 'ten_quizzes',
        name: 'Siêu Chăm',
        description: 'Hoàn thành 10 bài thi',
        icon: '🏅',
        condition: (stats) => stats.totalQuizzes >= 10,
    },
    {
        id: 'twenty_quizzes',
        name: 'Huyền Thoại',
        description: 'Hoàn thành 20 bài thi',
        icon: '👑',
        condition: (stats) => stats.totalQuizzes >= 20,
    },
    {
        id: 'perfect_score',
        name: 'Hoàn Hảo',
        description: 'Đạt điểm tuyệt đối 100%',
        icon: '💯',
        condition: (stats) => stats.perfectScores >= 1,
    },
    {
        id: 'three_perfects',
        name: 'Thiên Tài',
        description: '3 lần đạt điểm tuyệt đối',
        icon: '🧠',
        condition: (stats) => stats.perfectScores >= 3,
    },
    {
        id: 'streak_3',
        name: 'Lửa Nhỏ',
        description: 'Chuỗi 3 ngày liên tiếp',
        icon: '🔥',
        condition: (stats) => stats.maxStreak >= 3,
    },
    {
        id: 'streak_7',
        name: 'Ngọn Lửa',
        description: 'Chuỗi 7 ngày liên tiếp',
        icon: '🔥',
        condition: (stats) => stats.maxStreak >= 7,
    },
    {
        id: 'streak_14',
        name: 'Bão Lửa',
        description: 'Chuỗi 14 ngày liên tiếp',
        icon: '🌋',
        condition: (stats) => stats.maxStreak >= 14,
    },
    {
        id: 'streak_30',
        name: 'Bất Diệt',
        description: 'Chuỗi 30 ngày liên tiếp',
        icon: '⚡',
        condition: (stats) => stats.maxStreak >= 30,
    },
    {
        id: 'speed_demon',
        name: 'Tốc Độ',
        description: 'Hoàn thành bài thi trong 50% thời gian',
        icon: '⚡',
        condition: (stats) => stats.speedFinishes >= 1,
    },
    {
        id: 'high_avg',
        name: 'Xuất Sắc',
        description: 'Trung bình trên 80%',
        icon: '⭐',
        condition: (stats) => stats.totalQuizzes >= 3 && stats.avgPercent >= 80,
    },
];

export function checkAchievements(stats, currentAchievements = []) {
    const newAchievements = [];
    for (const achievement of ACHIEVEMENTS) {
        if (!currentAchievements.includes(achievement.id) && achievement.condition(stats)) {
            newAchievements.push(achievement);
        }
    }
    return newAchievements;
}

export function getAchievement(id) {
    return ACHIEVEMENTS.find(a => a.id === id);
}
