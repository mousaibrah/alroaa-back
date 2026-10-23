-- =====================================================================
-- Seed data (bilingual EN / AR): courses, sections, lessons, exams,
-- questions, options
-- Platform: منصة الرؤى للتعلّم البيئي (RNEC)
--
-- Requirements:
--   * schema_bilingual.sql is already applied.
--   * A user with id = 1 exists (used as author_id for every course).
-- Notes:
--   * Run this ONCE on an empty courses table (courses use ON CONFLICT on
--     slug, but sections/lessons/exams are not de-duplicated).
--   * Prices are stored BEFORE tax (design shows 300 + 15% VAT = 345 SAR).
--   * content_url / thumbnail_url are placeholders: replace with real assets.
--   * Arabic text is the original content; English is a translation of it.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------
-- Temporary helpers (live only for this session, nothing is left in your DB)
-- ---------------------------------------------------------------
CREATE FUNCTION pg_temp.add_section(
    p_course_slug text,
    p_title_en text, p_title_ar text,
    p_description_en text, p_description_ar text,
    p_sort int
) RETURNS void AS $$
    INSERT INTO course_sections (course_id, title_en, title_ar, description_en, description_ar, sort_order)
    VALUES ((SELECT id FROM courses WHERE slug = p_course_slug),
            p_title_en, p_title_ar, p_description_en, p_description_ar, p_sort);
$$ LANGUAGE sql;

CREATE FUNCTION pg_temp.add_lesson(
    p_course_slug text, p_section_sort int, p_sort int,
    p_title_en text, p_title_ar text,
    p_description_en text, p_description_ar text,
    p_type lesson_type,
    p_url text, p_duration_sec int, p_preview boolean DEFAULT FALSE
) RETURNS void AS $$
    INSERT INTO lessons (section_id, title_en, title_ar, description_en, description_ar,
                         lesson_type, content_url,
                         duration_sec, sort_order, is_preview)
    VALUES (
        (SELECT s.id FROM course_sections s
           JOIN courses c ON c.id = s.course_id
          WHERE c.slug = p_course_slug AND s.sort_order = p_section_sort),
        p_title_en, p_title_ar, p_description_en, p_description_ar,
        p_type, p_url, p_duration_sec, p_sort, p_preview);
$$ LANGUAGE sql;

CREATE FUNCTION pg_temp.add_exam(
    p_course_slug text,
    p_title_en text, p_title_ar text,
    p_description_en text, p_description_ar text,
    p_passing_score numeric, p_duration_sec int
) RETURNS void AS $$
    INSERT INTO exams (course_id, title_en, title_ar, description_en, description_ar,
                       passing_score, duration_sec)
    VALUES ((SELECT id FROM courses WHERE slug = p_course_slug),
            p_title_en, p_title_ar, p_description_en, p_description_ar,
            p_passing_score, p_duration_sec);
$$ LANGUAGE sql;

-- The exam is looked up by its ENGLISH title.
-- p_options_en / p_options_ar: option texts in the same display order;
-- p_correct: 1-based indexes of the correct ones
CREATE FUNCTION pg_temp.add_question(
    p_course_slug text, p_exam_title_en text, p_sort int,
    p_text_en text, p_text_ar text,
    p_type question_type, p_points numeric,
    p_options_en text[], p_options_ar text[], p_correct int[]
) RETURNS void AS $$
DECLARE
    v_exam_id int;
    v_question_id int;
BEGIN
    IF cardinality(p_options_en) <> cardinality(p_options_ar) THEN
        RAISE EXCEPTION 'EN/AR option count mismatch for question: %', p_text_en;
    END IF;

    SELECT e.id INTO v_exam_id
      FROM exams e JOIN courses c ON c.id = e.course_id
     WHERE c.slug = p_course_slug AND e.title_en = p_exam_title_en;

    INSERT INTO questions (exam_id, text_en, text_ar, question_type, points, sort_order)
    VALUES (v_exam_id, p_text_en, p_text_ar, p_type, p_points, p_sort)
    RETURNING id INTO v_question_id;

    INSERT INTO question_options (question_id, option_text_en, option_text_ar, is_correct, sort_order)
    SELECT v_question_id, o.txt_en, o.txt_ar, o.idx = ANY (p_correct), o.idx
      FROM unnest(p_options_en, p_options_ar) WITH ORDINALITY AS o(txt_en, txt_ar, idx);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------
-- Courses
-- ---------------------------------------------------------------
INSERT INTO courses (title_en, title_ar, slug, description_en, description_ar,
                     price, currency, status, author_id, thumbnail_url) VALUES
('Applied Environmental Inspection', 'التفتيش البيئي التطبيقي', 'applied-environmental-inspection',
 'Learn how to plan a visit, document observations, and prepare a professional, evidence-based report. A foundational self-paced program of 8 learning hours and 12 lessons, including exams and a practical assignment.',
 'تعلّم تنظيم الزيارة، وتوثيق الملاحظات، وإعداد تقرير مهني قائم على الأدلة. برنامج تأسيسي بالعربية للتعلّم الذاتي، مدته 8 ساعات تعلّم و12 درسًا، ويشمل اختبارات ومهمة تطبيقية.',
 300.00, 'SAR', 'published', 1, '/images/courses/applied-inspection.jpg'),

('Introduction to Waste Management', 'مقدمة في إدارة النفايات', 'waste-management-intro',
 'A foundational program introducing waste types, the waste management hierarchy, and the basics of segregation, storage, and tracking.',
 'برنامج تأسيسي يعرّفك بأنواع النفايات وتسلسل إدارتها وأسس الفصل والتخزين والتتبع.',
 250.00, 'SAR', 'published', 1, '/images/courses/waste-management.jpg'),

('Environmental Report Writing', 'إعداد تقرير بيئي', 'environmental-report-writing',
 'A hands-on workshop for writing a clear, objective environmental report: from organizing data to drafting recommendations.',
 'ورشة تطبيقية لكتابة تقرير بيئي واضح وموضوعي: من تنظيم البيانات إلى صياغة التوصيات.',
 280.00, 'SAR', 'published', 1, '/images/courses/report-writing.jpg'),

('Wildlife Protection', 'حماية الحياة الفطرية', 'wildlife-protection',
 'Learn the principles of wildlife and reserve protection, responsible visitor behavior, and the basics of monitoring and reporting.',
 'تعرّف على مبادئ حماية الحياة الفطرية والمحميات، وسلوك الزائر المسؤول، وأساسيات الرصد والإبلاغ.',
 320.00, 'SAR', 'published', 1, '/images/courses/wildlife.jpg'),

('Environmental Compliance Basics', 'أساسيات الالتزام البيئي', 'environmental-compliance-basics',
 'An entry point for graduates to understand environmental compliance, records, permits, and corrective actions.',
 'مدخل للخريجين لفهم الالتزام البيئي والسجلات والتراخيص والإجراءات التصحيحية.',
 200.00, 'SAR', 'draft', 1, '/images/courses/compliance-basics.jpg')
ON CONFLICT (slug) DO NOTHING;

-- =====================================================================
-- 1) Applied Environmental Inspection (3 sections / 12 lessons / 2 exams)
-- =====================================================================
SELECT pg_temp.add_section('applied-environmental-inspection',
    'Environmental Visit Fundamentals', 'أساسيات الزيارة البيئية',
    'Understanding the scope of the visit and preparing the checklist.',
    'التعرف على نطاق الزيارة وتجهيز قائمة التحقق.', 1);
SELECT pg_temp.add_section('applied-environmental-inspection',
    'Collecting Evidence and Documenting Observations', 'جمع الأدلة وتوثيق الملاحظات',
    'How to collect evidence, document an observation, and distinguish it from a conclusion.',
    'كيف تجمع الأدلة وتوثق الملاحظة وتميّزها عن الاستنتاج.', 2);
SELECT pg_temp.add_section('applied-environmental-inspection',
    'Report and Practical Assignment', 'التقرير والمهمة التطبيقية',
    'Writing a professional report, presenting a follow-up plan, then completing the practical assignment.',
    'كتابة تقرير مهني وتقديم خطة متابعة ثم تنفيذ المهمة التطبيقية.', 3);

-- Section 1 (3 lessons)
SELECT pg_temp.add_lesson('applied-environmental-inspection', 1, 1,
    'Program Introduction', 'مقدمة البرنامج',
    'An overview of the program goals and how learning works.',
    'نظرة عامة على أهداف البرنامج وطريقة التعلم.',
    'video', 'https://cdn.example.com/videos/inspection/1-1.mp4', 360, TRUE);
SELECT pg_temp.add_lesson('applied-environmental-inspection', 1, 2,
    'Visit Scope', 'نطاق الزيارة',
    'Defining the scope and objectives of the visit before carrying it out.',
    'تحديد نطاق الزيارة وأهدافها قبل التنفيذ.',
    'video', 'https://cdn.example.com/videos/inspection/1-2.mp4', 600);
SELECT pg_temp.add_lesson('applied-environmental-inspection', 1, 3,
    'The Checklist', 'قائمة التحقق',
    'Preparing a checklist suited to the scope of the task.',
    'إعداد قائمة تحقق مناسبة لنطاق المهمة.',
    'video', 'https://cdn.example.com/videos/inspection/1-3.mp4', 540);

-- Section 2 (4 lessons)
SELECT pg_temp.add_lesson('applied-environmental-inspection', 2, 1,
    'Documenting Observations', 'توثيق الملاحظات',
    'Record accurately what you saw, specify the location and date, and tie the observation to evidence that can be reviewed.',
    'دوّن ما شاهدته بدقة، وحدد الموقع والتاريخ، واربط الملاحظة بدليل يمكن مراجعته.',
    'video', 'https://cdn.example.com/videos/inspection/2-1.mp4', 720);
SELECT pg_temp.add_lesson('applied-environmental-inspection', 2, 2,
    'Types of Evidence and How to Collect Them', 'أنواع الأدلة وجمعها',
    'Photos, records, and documents: when to use them and how to keep them.',
    'الصور والسجلات والمستندات: متى تُستخدم وكيف تُحفظ.',
    'video', 'https://cdn.example.com/videos/inspection/2-2.mp4', 660);
SELECT pg_temp.add_lesson('applied-environmental-inspection', 2, 3,
    'Distinguishing Observation, Evidence, and Conclusion', 'التمييز بين الملاحظة والدليل والاستنتاج',
    'Three concepts that must not be mixed in the report.',
    'ثلاثة مفاهيم يجب ألا تختلط في التقرير.',
    'video', 'https://cdn.example.com/videos/inspection/2-3.mp4', 540);
SELECT pg_temp.add_lesson('applied-environmental-inspection', 2, 4,
    'File: Visit Checklist (PDF)', 'ملف: قائمة تحقق للزيارة (PDF)',
    'A downloadable checklist template for field use.',
    'نموذج قائمة تحقق قابل للتنزيل والاستخدام الميداني.',
    'text', 'https://cdn.example.com/files/inspection/visit-checklist.pdf', NULL);

-- Section 3 (5 lessons)
SELECT pg_temp.add_lesson('applied-environmental-inspection', 3, 1,
    'Structure of a Professional Report', 'بنية التقرير المهني',
    'Report sections and their order: summary, observations and evidence, recommendations, follow-up.',
    'أقسام التقرير وترتيبها: الملخص، الملاحظات والأدلة، التوصيات، المتابعة.',
    'video', 'https://cdn.example.com/videos/inspection/3-1.mp4', 840);
SELECT pg_temp.add_lesson('applied-environmental-inspection', 3, 2,
    'Phrasing Observations', 'صياغة الملاحظات',
    'Precise, neutral phrasing tied to evidence.',
    'صياغة دقيقة وحيادية ومرتبطة بالدليل.',
    'video', 'https://cdn.example.com/videos/inspection/3-2.mp4', 600);
SELECT pg_temp.add_lesson('applied-environmental-inspection', 3, 3,
    'Writing Recommendations', 'كتابة التوصيات',
    'How to write a practical recommendation tied to a documented observation.',
    'كيف تكتب توصية عملية مرتبطة بملاحظة موثقة.',
    'text', 'https://cdn.example.com/content/inspection/3-3.html', NULL);
SELECT pg_temp.add_lesson('applied-environmental-inspection', 3, 4,
    'Presenting the Follow-up Plan', 'تقديم خطة المتابعة',
    'Defining the owner, the deadline, and the verification indicator.',
    'تحديد المسؤول والموعد ومؤشر التحقق.',
    'video', 'https://cdn.example.com/videos/inspection/3-4.mp4', 480);
SELECT pg_temp.add_lesson('applied-environmental-inspection', 3, 5,
    'Practical Assignment Instructions', 'تعليمات المهمة التطبيقية',
    'Review the training facility case, then write three evidence-backed observations and set the follow-up priority for each.',
    'راجع حالة المنشأة التدريبية، ثم اكتب ثلاث ملاحظات مدعومة بأدلة وحدد أولوية المتابعة لكل ملاحظة.',
    'text', 'https://cdn.example.com/content/inspection/3-5.html', NULL);

-- Exam A: unit 2 quiz (10 questions x 10 points = 100, pass at 70)
SELECT pg_temp.add_exam('applied-environmental-inspection',
    'Unit 2 Quiz', 'اختبار الوحدة الثانية',
    'Test your understanding of documenting observations and collecting evidence before moving on.',
    'اختبر فهمك لتوثيق الملاحظات وجمع الأدلة قبل الانتقال.', 70.00, 1200);

SELECT pg_temp.add_question('applied-environmental-inspection', 'Unit 2 Quiz', 1,
    'A good field observation specifies the location and date.',
    'الملاحظة الميدانية الجيدة تحدد الموقع والتاريخ.',
    'true_false', 10,
    ARRAY['True','False'], ARRAY['صح','خطأ'], ARRAY[1]);
SELECT pg_temp.add_question('applied-environmental-inspection', 'Unit 2 Quiz', 2,
    'Which of the following is direct evidence of a liquid leak on site?',
    'أي مما يلي يُعد دليلًا مباشرًا على تسرب سائل في الموقع؟',
    'single_choice', 10,
    ARRAY['An opinion from a colleague about the site','A dated photo of the leak with its location specified','A general estimate of the condition of the facility','A news item about a similar facility'],
    ARRAY['رأي أحد الزملاء عن الموقع','صورة مؤرخة للتسرب مع تحديد موقعه','تقدير عام لحالة المنشأة','خبر منشور عن منشأة مشابهة'],
    ARRAY[2]);
SELECT pg_temp.add_question('applied-environmental-inspection', 'Unit 2 Quiz', 3,
    'Select the elements that must be present when documenting an observation.',
    'اختر العناصر الواجب توفرها عند توثيق الملاحظة.',
    'multiple_choice', 10,
    ARRAY['The location','The date and time','Evidence linked to the observation','A personal opinion about the person responsible for the facility'],
    ARRAY['الموقع','التاريخ والوقت','الدليل المرتبط بالملاحظة','رأي شخصي عن المسؤول عن المنشأة'],
    ARRAY[1,2,3]);
SELECT pg_temp.add_question('applied-environmental-inspection', 'Unit 2 Quiz', 4,
    'What is the most appropriate step before drafting an observation in the visit report?',
    'ما الإجراء الأنسب قبل صياغة ملاحظة في تقرير الزيارة؟',
    'single_choice', 10,
    ARRAY['Relying on a general impression without documentation','Linking the observation to clear evidence that can be reviewed','Copying a description from a report on another facility','Issuing a conclusion before examining the information'],
    ARRAY['الاعتماد على انطباع عام دون توثيق','ربط الملاحظة بدليل واضح قابل للمراجعة','نسخ وصف من تقرير منشأة أخرى','إصدار استنتاج قبل فحص المعلومات'],
    ARRAY[2]);
SELECT pg_temp.add_question('applied-environmental-inspection', 'Unit 2 Quiz', 5,
    'A conclusion can be written before enough evidence has been collected.',
    'يمكن كتابة الاستنتاج قبل جمع الأدلة الكافية.',
    'true_false', 10,
    ARRAY['True','False'], ARRAY['صح','خطأ'], ARRAY[2]);
SELECT pg_temp.add_question('applied-environmental-inspection', 'Unit 2 Quiz', 6,
    'What is the most accurate difference between an observation and a conclusion?',
    'ما الفرق الأدق بين الملاحظة والاستنتاج؟',
    'single_choice', 10,
    ARRAY['There is no difference between them','An observation is an interpretation and a conclusion is a description','An observation is what was seen and documented, and a conclusion is an interpretation based on evidence','A conclusion is what is written first in the field'],
    ARRAY['لا فرق بينهما','الملاحظة تفسير والاستنتاج وصف','الملاحظة ما شوهد وتم توثيقه، والاستنتاج تفسير مبني على الأدلة','الاستنتاج هو ما يُكتب أولًا في الميدان'],
    ARRAY[3]);
SELECT pg_temp.add_question('applied-environmental-inspection', 'Unit 2 Quiz', 7,
    'You found a conflict between documented evidence and an oral statement. What is the most appropriate action?',
    'وجدت تعارضًا بين دليل موثق وإفادة شفهية. ما التصرف الأنسب؟',
    'single_choice', 10,
    ARRAY['Ignore the oral statement without mentioning it','Delete the evidence to avoid the conflict','Choose only the source that best matches the view of the inspector','Record both sources and note the conflict in the report'],
    ARRAY['إهمال الإفادة الشفهية دون ذكرها','حذف الدليل لتجنب التعارض','اختيار المصدر الأنسب لرأي المفتش فقط','تسجيل المصدرين والإشارة إلى التعارض في التقرير'],
    ARRAY[4]);
SELECT pg_temp.add_question('applied-environmental-inspection', 'Unit 2 Quiz', 8,
    'Which of the following is suitable as evidence in a visit report?',
    'أي مما يلي يصلح كدليل في تقرير الزيارة؟',
    'multiple_choice', 10,
    ARRAY['Dated photos','Operating records','Official documents','Circulating rumors'],
    ARRAY['صور مؤرخة','سجلات التشغيل','مستندات رسمية','شائعات متداولة'],
    ARRAY[1,2,3]);
SELECT pg_temp.add_question('applied-environmental-inspection', 'Unit 2 Quiz', 9,
    'A version log must be kept for the files that support the evidence.',
    'يجب الحفاظ على سجل نسخ للملفات الداعمة للأدلة.',
    'true_false', 10,
    ARRAY['True','False'], ARRAY['صح','خطأ'], ARRAY[1]);
SELECT pg_temp.add_question('applied-environmental-inspection', 'Unit 2 Quiz', 10,
    'Photography was not possible in part of the site for safety reasons. What is the most appropriate action?',
    'تعذر التصوير في جزء من الموقع لأسباب تتعلق بالسلامة. ما التصرف الأنسب؟',
    'single_choice', 10,
    ARRAY['Ignore the observation','Photograph the site despite the danger','Document the reason in writing and use an available alternative piece of evidence','Write that there are no violations'],
    ARRAY['تجاهل الملاحظة','تصوير الموقع رغم الخطر','توثيق السبب كتابيًا واستخدام دليل بديل متاح','كتابة أنه لا توجد مخالفات'],
    ARRAY[3]);

-- Exam B: final exam (5 questions x 20 points = 100, pass at 70)
SELECT pg_temp.add_exam('applied-environmental-inspection',
    'Program Final Exam', 'الاختبار النهائي للبرنامج',
    'The final exam for completing the Applied Environmental Inspection program.',
    'الاختبار النهائي لإتمام برنامج التفتيش البيئي التطبيقي.', 70.00, 1800);

SELECT pg_temp.add_question('applied-environmental-inspection', 'Program Final Exam', 1,
    'What is the most appropriate order of the sections of a professional report?',
    'ما الترتيب الأنسب لأقسام التقرير المهني؟',
    'single_choice', 20,
    ARRAY['Recommendations, then summary, then evidence','Summary, then observations and evidence, then recommendations, then follow-up plan','Follow-up plan, then summary, then observations','Evidence, then follow-up plan, then summary'],
    ARRAY['التوصيات ثم الملخص ثم الأدلة','الملخص ثم الملاحظات والأدلة ثم التوصيات ثم خطة المتابعة','خطة المتابعة ثم الملخص ثم الملاحظات','الأدلة ثم خطة المتابعة ثم الملخص'],
    ARRAY[2]);
SELECT pg_temp.add_question('applied-environmental-inspection', 'Program Final Exam', 2,
    'Every recommendation must be tied to a documented observation.',
    'يجب أن ترتبط كل توصية بملاحظة موثقة.',
    'true_false', 20,
    ARRAY['True','False'], ARRAY['صح','خطأ'], ARRAY[1]);
SELECT pg_temp.add_question('applied-environmental-inspection', 'Program Final Exam', 3,
    'Select the elements included in a good follow-up plan.',
    'اختر العناصر التي تتضمنها خطة المتابعة الجيدة.',
    'multiple_choice', 20,
    ARRAY['The person responsible for implementation','The implementation deadline','An indicator to verify closure','Hiding previous observations'],
    ARRAY['مسؤول التنفيذ','موعد التنفيذ','مؤشر التحقق من الإغلاق','إخفاء الملاحظات السابقة'],
    ARRAY[1,2,3]);
SELECT pg_temp.add_question('applied-environmental-inspection', 'Program Final Exam', 4,
    'Which phrasing is the most precise and neutral?',
    'أي صياغة هي الأدق والأكثر حيادية؟',
    'single_choice', 20,
    ARRAY['The site is very messy and they do not care about cleanliness','An accumulation of unsegregated waste was noted near the east gate (photo 3, dated on the day of the visit)','It is obvious that management is negligent','The facility appears to be in violation'],
    ARRAY['الموقع فوضوي جدًا ولا يهتمون بالنظافة','لوحظ تراكم نفايات غير مفصولة قرب البوابة الشرقية (صورة 3 بتاريخ الزيارة)','من الواضح أن الإدارة مهملة','يبدو أن المنشأة مخالفة'],
    ARRAY[2]);
SELECT pg_temp.add_question('applied-environmental-inspection', 'Program Final Exam', 5,
    'The link between evidence and observation carries more weight than the other criteria for assessing the practical assignment.',
    'يُمنح ارتباط الدليل بالملاحظة وزنًا أكبر من باقي معايير تقييم المهمة التطبيقية.',
    'true_false', 20,
    ARRAY['True','False'], ARRAY['صح','خطأ'], ARRAY[1]);

-- =====================================================================
-- 2) Introduction to Waste Management
-- =====================================================================
SELECT pg_temp.add_section('waste-management-intro',
    'Waste Management Fundamentals', 'أسس إدارة النفايات',
    'Waste types and the management hierarchy.', 'أنواع النفايات وتسلسل الإدارة.', 1);
SELECT pg_temp.add_section('waste-management-intro',
    'Segregation, Storage, and Tracking', 'الفصل والتخزين والتتبع',
    'Practical practices inside the facility.', 'الممارسات العملية داخل المنشأة.', 2);

SELECT pg_temp.add_lesson('waste-management-intro', 1, 1,
    'Introduction to Waste Management', 'مقدمة في إدارة النفايات',
    'Why waste management matters and what its goals are.',
    'لماذا تهم إدارة النفايات وما أهدافها.',
    'video', 'https://cdn.example.com/videos/waste/1-1.mp4', 420, TRUE);
SELECT pg_temp.add_lesson('waste-management-intro', 1, 2,
    'Types of Waste', 'أنواع النفايات',
    'General, hazardous, medical, and industrial waste.',
    'النفايات العامة والخطرة والطبية والصناعية.',
    'video', 'https://cdn.example.com/videos/waste/1-2.mp4', 600);
SELECT pg_temp.add_lesson('waste-management-intro', 2, 1,
    'Segregation at Source', 'الفصل من المصدر',
    'How to segregate waste and prepare containers.',
    'كيفية فصل النفايات وتجهيز الحاويات.',
    'video', 'https://cdn.example.com/videos/waste/2-1.mp4', 540);
SELECT pg_temp.add_lesson('waste-management-intro', 2, 2,
    'Waste Tracking Log', 'سجل تتبع النفايات',
    'A template and explanation for documenting the waste path.',
    'نموذج وشرح لتوثيق مسار النفايات.',
    'text', 'https://cdn.example.com/content/waste/2-2.html', NULL);

SELECT pg_temp.add_exam('waste-management-intro',
    'Introduction to Waste Management Quiz', 'اختبار مقدمة في إدارة النفايات',
    'Measuring understanding of waste management fundamentals.',
    'قياس فهم أسس إدارة النفايات.', 70.00, 900);

SELECT pg_temp.add_question('waste-management-intro', 'Introduction to Waste Management Quiz', 1,
    'Which option is best for the environment in the waste management hierarchy?',
    'ما الخيار الأفضل بيئيًا في تسلسل إدارة النفايات؟',
    'single_choice', 20,
    ARRAY['Landfilling','Reducing generation at the source','Incineration','Transporting it to a distant site'],
    ARRAY['الدفن','تقليل التوليد من المصدر','الحرق','النقل إلى موقع بعيد'],
    ARRAY[2]);
SELECT pg_temp.add_question('waste-management-intro', 'Introduction to Waste Management Quiz', 2,
    'Segregation at source makes recycling easier.',
    'فصل النفايات من المصدر يسهّل إعادة التدوير.',
    'true_false', 20,
    ARRAY['True','False'], ARRAY['صح','خطأ'], ARRAY[1]);
SELECT pg_temp.add_question('waste-management-intro', 'Introduction to Waste Management Quiz', 3,
    'Select examples of hazardous waste.',
    'اختر أمثلة النفايات الخطرة.',
    'multiple_choice', 20,
    ARRAY['Used batteries','Chemical solvents','Infectious medical waste','Office paper'],
    ARRAY['البطاريات المستعملة','المذيبات الكيميائية','النفايات الطبية المعدية','أوراق المكاتب'],
    ARRAY[1,2,3]);
SELECT pg_temp.add_question('waste-management-intro', 'Introduction to Waste Management Quiz', 4,
    'Hazardous waste may be mixed with general waste to reduce cost.',
    'يجوز خلط النفايات الخطرة مع النفايات العامة لتقليل التكلفة.',
    'true_false', 20,
    ARRAY['True','False'], ARRAY['صح','خطأ'], ARRAY[2]);
SELECT pg_temp.add_question('waste-management-intro', 'Introduction to Waste Management Quiz', 5,
    'What is the purpose of the waste tracking log?',
    'ما الغرض من سجل تتبع النفايات؟',
    'single_choice', 20,
    ARRAY['Decorating management files','Documenting the path of waste from generation to treatment','Reducing the number of containers','Replacing permits'],
    ARRAY['تزيين ملفات الإدارة','توثيق مسار النفايات من التوليد حتى المعالجة','تقليل عدد الحاويات','استبدال التراخيص'],
    ARRAY[2]);

-- =====================================================================
-- 3) Environmental Report Writing
-- =====================================================================
SELECT pg_temp.add_section('environmental-report-writing',
    'Organizing Data', 'تنظيم البيانات',
    'From raw data to a clear message.', 'من البيانات الخام إلى رسالة واضحة.', 1);
SELECT pg_temp.add_section('environmental-report-writing',
    'Writing and Review', 'الكتابة والمراجعة',
    'Phrasing, recommendations, and final review.', 'الصياغة والتوصيات والمراجعة النهائية.', 2);

SELECT pg_temp.add_lesson('environmental-report-writing', 1, 1,
    'Introduction to the Environmental Report', 'مقدمة التقرير البيئي',
    'Report types and their audiences.', 'أنواع التقارير وجمهورها.',
    'video', 'https://cdn.example.com/videos/report/1-1.mp4', 480, TRUE);
SELECT pg_temp.add_lesson('environmental-report-writing', 1, 2,
    'Organizing Evidence and Data', 'تنظيم الأدلة والبيانات',
    'Arranging data and linking it to findings.', 'ترتيب البيانات وربطها بالنتائج.',
    'video', 'https://cdn.example.com/videos/report/1-2.mp4', 600);
SELECT pg_temp.add_lesson('environmental-report-writing', 2, 1,
    'Objective Writing', 'الصياغة الموضوعية',
    'Neutral style and the language of the report.', 'الأسلوب الحيادي ولغة التقرير.',
    'video', 'https://cdn.example.com/videos/report/2-1.mp4', 660);
SELECT pg_temp.add_lesson('environmental-report-writing', 2, 2,
    'Report Review Checklist', 'قائمة مراجعة التقرير',
    'Review steps before sending.', 'خطوات المراجعة قبل الإرسال.',
    'text', 'https://cdn.example.com/content/report/2-2.html', NULL);

SELECT pg_temp.add_exam('environmental-report-writing',
    'Environmental Report Writing Quiz', 'اختبار إعداد تقرير بيئي',
    'Measuring skills in structuring and writing a report.',
    'قياس مهارات بناء وصياغة التقرير.', 70.00, 900);

SELECT pg_temp.add_question('environmental-report-writing', 'Environmental Report Writing Quiz', 1,
    'Which part of the report summarizes the main findings for the decision maker?',
    'أي جزء في التقرير يلخص النتائج الرئيسية لصانع القرار؟',
    'single_choice', 20,
    ARRAY['The appendices','The executive summary','The reference list','The cover page'],
    ARRAY['الملحقات','الملخص التنفيذي','قائمة المراجع','الغلاف'],
    ARRAY[2]);
SELECT pg_temp.add_question('environmental-report-writing', 'Environmental Report Writing Quiz', 2,
    'Every conclusion in the report must be tied to evidence.',
    'يجب أن يرتبط كل استنتاج في التقرير بدليل.',
    'true_false', 20,
    ARRAY['True','False'], ARRAY['صح','خطأ'], ARRAY[1]);
SELECT pg_temp.add_question('environmental-report-writing', 'Environmental Report Writing Quiz', 3,
    'Which phrasing is most suitable in a professional report?',
    'أي الصياغات أنسب في تقرير مهني؟',
    'single_choice', 20,
    ARRAY['The situation is very bad','A breach in material storage was noted near the west exit (photo 2)','It seems the team does not care','Almost everything is in violation'],
    ARRAY['الوضع سيئ جدًا','لوحظ تجاوز في تخزين المواد قرب المخرج الغربي (صورة 2)','يبدو أن الفريق لا يهتم','كل شيء تقريبًا مخالف'],
    ARRAY[2]);
SELECT pg_temp.add_question('environmental-report-writing', 'Environmental Report Writing Quiz', 4,
    'Select the items to review in a report before sending it.',
    'اختر عناصر مراجعة التقرير قبل الإرسال.',
    'multiple_choice', 20,
    ARRAY['Verifying the figures','Consistency of terminology','The presence of references to evidence','Adding personal opinions'],
    ARRAY['التحقق من الأرقام','اتساق المصطلحات','وجود مراجع للأدلة','إضافة آراء شخصية'],
    ARRAY[1,2,3]);
SELECT pg_temp.add_question('environmental-report-writing', 'Environmental Report Writing Quiz', 5,
    'Stating the limitations of the data in the report can be skipped.',
    'يمكن إهمال ذكر حدود البيانات في التقرير.',
    'true_false', 20,
    ARRAY['True','False'], ARRAY['صح','خطأ'], ARRAY[2]);

-- =====================================================================
-- 4) Wildlife Protection
-- =====================================================================
SELECT pg_temp.add_section('wildlife-protection',
    'Principles of Protection', 'مبادئ الحماية',
    'Threats and general regulations.', 'التهديدات والأنظمة العامة.', 1);
SELECT pg_temp.add_section('wildlife-protection',
    'Monitoring and Reporting', 'الرصد والإبلاغ',
    'Visitor behavior and monitoring basics.', 'سلوك الزائر وأساسيات الرصد.', 2);

SELECT pg_temp.add_lesson('wildlife-protection', 1, 1,
    'Introduction to Wildlife Protection', 'مقدمة في حماية الحياة الفطرية',
    'The importance of biodiversity and reserves.', 'أهمية التنوع الأحيائي والمحميات.',
    'video', 'https://cdn.example.com/videos/wildlife/1-1.mp4', 480, TRUE);
SELECT pg_temp.add_lesson('wildlife-protection', 1, 2,
    'Threats to Wildlife', 'تهديدات الحياة الفطرية',
    'Habitat loss, overhunting, and invasive species.', 'فقدان الموائل والصيد الجائر والأنواع الغازية.',
    'video', 'https://cdn.example.com/videos/wildlife/1-2.mp4', 600);
SELECT pg_temp.add_lesson('wildlife-protection', 2, 1,
    'Responsible Visitor Behavior', 'سلوك الزائر المسؤول',
    'Staying on designated trails and not disturbing animals.', 'المسارات المحددة وعدم إزعاج الكائنات.',
    'video', 'https://cdn.example.com/videos/wildlife/2-1.mp4', 540);
SELECT pg_temp.add_lesson('wildlife-protection', 2, 2,
    'Documenting Sightings and Reporting', 'توثيق الرصد والإبلاغ',
    'How to document a sighting and notify the competent authority.', 'كيف توثق الرصد وتبلغ الجهة المختصة.',
    'text', 'https://cdn.example.com/content/wildlife/2-2.html', NULL);

SELECT pg_temp.add_exam('wildlife-protection',
    'Wildlife Protection Quiz', 'اختبار حماية الحياة الفطرية',
    'Measuring understanding of protection principles and visitor behavior.',
    'قياس فهم مبادئ الحماية وسلوك الزائر.', 70.00, 900);

SELECT pg_temp.add_question('wildlife-protection', 'Wildlife Protection Quiz', 1,
    'Which behavior supports wildlife protection in reserves?',
    'أي سلوك يدعم حماية الحياة الفطرية في المحميات؟',
    'single_choice', 20,
    ARRAY['Leaving the trails to take photos from closer','Sticking to designated trails and not disturbing animals','Leaving natural waste behind','Approaching nests'],
    ARRAY['الخروج عن المسارات لتصوير أقرب','الالتزام بالمسارات المحددة وعدم إزعاج الكائنات','ترك المخلفات الطبيعية','الاقتراب من الأعشاش'],
    ARRAY[2]);
SELECT pg_temp.add_question('wildlife-protection', 'Wildlife Protection Quiz', 2,
    'Feeding wild animals is safe and encouraged.',
    'إطعام الحيوانات البرية آمن ومشجع عليه.',
    'true_false', 20,
    ARRAY['True','False'], ARRAY['صح','خطأ'], ARRAY[2]);
SELECT pg_temp.add_question('wildlife-protection', 'Wildlife Protection Quiz', 3,
    'Select examples of threats to wildlife.',
    'اختر أمثلة على تهديدات الحياة الفطرية.',
    'multiple_choice', 20,
    ARRAY['Habitat loss','Overhunting','Invasive species','Compliance with regulations'],
    ARRAY['فقدان الموائل','الصيد الجائر','الأنواع الغازية','الالتزام بالأنظمة'],
    ARRAY[1,2,3]);
SELECT pg_temp.add_question('wildlife-protection', 'Wildlife Protection Quiz', 4,
    'When you spot an injured animal, what is the most appropriate action?',
    'عند رصد حيوان مصاب، ما التصرف الأنسب؟',
    'single_choice', 20,
    ARRAY['Pick it up and carry it yourself','Notify the competent authority and avoid direct contact','Ignore it','Feed it'],
    ARRAY['حمله ونقله بنفسك','إبلاغ الجهة المختصة وعدم التعامل المباشر','تجاهله','إطعامه'],
    ARRAY[2]);
SELECT pg_temp.add_question('wildlife-protection', 'Wildlife Protection Quiz', 5,
    'Documenting sightings with the date and location helps with follow-up.',
    'توثيق الرصد بالتاريخ والموقع يفيد في المتابعة.',
    'true_false', 20,
    ARRAY['True','False'], ARRAY['صح','خطأ'], ARRAY[1]);

-- =====================================================================
-- 5) Environmental Compliance Basics (draft)
-- =====================================================================
SELECT pg_temp.add_section('environmental-compliance-basics',
    'Compliance Concepts', 'مفاهيم الالتزام',
    'What environmental compliance is and its records.', 'ما هو الالتزام البيئي وسجلاته.', 1);
SELECT pg_temp.add_section('environmental-compliance-basics',
    'Follow-up and Correction', 'المتابعة والتصحيح',
    'Reporting and corrective actions.', 'الإبلاغ والإجراءات التصحيحية.', 2);

SELECT pg_temp.add_lesson('environmental-compliance-basics', 1, 1,
    'What Is Environmental Compliance?', 'ما هو الالتزام البيئي؟',
    'Definition of compliance, the authorities, and the requirements.', 'تعريف الالتزام والجهات والمتطلبات.',
    'video', 'https://cdn.example.com/videos/compliance/1-1.mp4', 420, TRUE);
SELECT pg_temp.add_lesson('environmental-compliance-basics', 1, 2,
    'Compliance Records and Permits', 'سجلات الالتزام والتراخيص',
    'The key records and how to keep them.', 'أهم السجلات وكيفية حفظها.',
    'video', 'https://cdn.example.com/videos/compliance/1-2.mp4', 540);
SELECT pg_temp.add_lesson('environmental-compliance-basics', 2, 1,
    'Reporting Violations', 'الإبلاغ عن المخالفات',
    'The importance of early reporting.', 'أهمية الإبلاغ المبكر.',
    'video', 'https://cdn.example.com/videos/compliance/2-1.mp4', 480);
SELECT pg_temp.add_lesson('environmental-compliance-basics', 2, 2,
    'Corrective Actions', 'الإجراءات التصحيحية',
    'From the cause of the violation to documenting closure.', 'من سبب المخالفة إلى توثيق الإغلاق.',
    'text', 'https://cdn.example.com/content/compliance/2-2.html', NULL);

SELECT pg_temp.add_exam('environmental-compliance-basics',
    'Environmental Compliance Basics Quiz', 'اختبار أساسيات الالتزام البيئي',
    'Measuring understanding of compliance concepts and records.',
    'قياس فهم مفاهيم الالتزام وسجلاته.', 70.00, 900);

SELECT pg_temp.add_question('environmental-compliance-basics', 'Environmental Compliance Basics Quiz', 1,
    'What does environmental compliance mean?',
    'ماذا يعني الالتزام البيئي؟',
    'single_choice', 20,
    ARRAY['Complying with the applicable environmental regulations and requirements','Relying on green marketing only','Stopping the activity','Relying on personal judgment'],
    ARRAY['الامتثال للأنظمة والاشتراطات البيئية المنطبقة','الاكتفاء بالتسويق الأخضر','التوقف عن النشاط','الاعتماد على الاجتهاد الشخصي'],
    ARRAY[1]);
SELECT pg_temp.add_question('environmental-compliance-basics', 'Environmental Compliance Basics Quiz', 2,
    'Obtaining a permit once is enough, with no later review.',
    'يكفي الحصول على الترخيص مرة واحدة دون أي مراجعة لاحقة.',
    'true_false', 20,
    ARRAY['True','False'], ARRAY['صح','خطأ'], ARRAY[2]);
SELECT pg_temp.add_question('environmental-compliance-basics', 'Environmental Compliance Basics Quiz', 3,
    'Select examples of compliance records.',
    'اختر أمثلة على سجلات الالتزام.',
    'multiple_choice', 20,
    ARRAY['Permits','Monitoring reports','Maintenance records for pollution control equipment','Marketing advertisements'],
    ARRAY['التراخيص','تقارير الرصد','سجلات صيانة معدات الحد من التلوث','إعلانات تسويقية'],
    ARRAY[1,2,3]);
SELECT pg_temp.add_question('environmental-compliance-basics', 'Environmental Compliance Basics Quiz', 4,
    'Early reporting of a violation reduces its impact.',
    'الإبلاغ المبكر عن المخالفة يقلل أثرها.',
    'true_false', 20,
    ARRAY['True','False'], ARRAY['صح','خطأ'], ARRAY[1]);
SELECT pg_temp.add_question('environmental-compliance-basics', 'Environmental Compliance Basics Quiz', 5,
    'Which action counts as a corrective action?',
    'أي إجراء يُعد إجراءً تصحيحيًا؟',
    'single_choice', 20,
    ARRAY['Concealing the violation','Addressing the cause of the violation and documenting its closure','Postponing the review','Changing the date of the report'],
    ARRAY['إخفاء المخالفة','معالجة سبب المخالفة وتوثيق إغلاقها','تأجيل المراجعة','تغيير تاريخ التقرير'],
    ARRAY[2]);

COMMIT;

-- ---------------------------------------------------------------
-- Quick check
-- ---------------------------------------------------------------
-- SELECT c.title_en, c.title_ar,
--        COUNT(DISTINCT s.id) sections, COUNT(DISTINCT l.id) lessons, COUNT(DISTINCT e.id) exams
--   FROM courses c
--   LEFT JOIN course_sections s ON s.course_id = c.id
--   LEFT JOIN lessons l ON l.section_id = s.id
--   LEFT JOIN exams e ON e.course_id = c.id
--  GROUP BY c.title_en, c.title_ar;