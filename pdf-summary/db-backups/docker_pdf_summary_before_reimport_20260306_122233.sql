/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19-11.4.10-MariaDB, for debian-linux-gnu (x86_64)
--
-- Host: localhost    Database: pdf_summary
-- ------------------------------------------------------
-- Server version	11.4.10-MariaDB-ubu2404

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*M!100616 SET @OLD_NOTE_VERBOSITY=@@NOTE_VERBOSITY, NOTE_VERBOSITY=0 */;

--
-- Current Database: `pdf_summary`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `pdf_summary` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */;

USE `pdf_summary`;

--
-- Table structure for table `admin_activity_logs`
--

DROP TABLE IF EXISTS `admin_activity_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_activity_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `admin_user_id` int(11) NOT NULL,
  `action` varchar(100) NOT NULL,
  `target_type` varchar(50) DEFAULT NULL,
  `target_id` int(11) DEFAULT NULL,
  `details` text DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `admin_user_id` (`admin_user_id`),
  KEY `ix_admin_activity_logs_action` (`action`),
  KEY `ix_admin_activity_logs_id` (`id`),
  KEY `ix_admin_activity_logs_created_at` (`created_at`),
  CONSTRAINT `admin_activity_logs_ibfk_1` FOREIGN KEY (`admin_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `admin_activity_logs`
--

LOCK TABLES `admin_activity_logs` WRITE;
/*!40000 ALTER TABLE `admin_activity_logs` DISABLE KEYS */;
INSERT INTO `admin_activity_logs` VALUES
(1,4,'USER_REGISTERED','USER',4,'{\"username\": \"jayyoonlee\", \"email\": \"jayyoon.lee98@gmail.com\"}','2026-03-06 03:12:14','172.18.0.1'),
(2,5,'USER_REGISTERED','USER',5,'{\"username\": \"osj2020\", \"email\": \"osj4040@naver.com\"}','2026-03-06 03:12:18','172.18.0.1'),
(3,4,'USER_LOGIN','USER',4,'{\"username\": \"jayyoonlee\", \"ip_address\": \"172.18.0.1\"}','2026-03-06 03:12:19','172.18.0.1'),
(4,5,'USER_LOGIN','USER',5,'{\"username\": \"osj2020\", \"ip_address\": \"172.18.0.1\"}','2026-03-06 03:12:25','172.18.0.1');
/*!40000 ALTER TABLE `admin_activity_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `pdf_documents`
--

DROP TABLE IF EXISTS `pdf_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `pdf_documents` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `filename` varchar(255) NOT NULL,
  `extracted_text` longtext DEFAULT NULL,
  `summary` longtext DEFAULT NULL,
  `model_used` varchar(100) DEFAULT NULL,
  `char_count` int(11) DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `user_id` int(11) DEFAULT NULL,
  `original_translation` longtext DEFAULT NULL COMMENT '원문 영문 번역',
  `summary_translation` longtext DEFAULT NULL COMMENT '요약 영문 번역',
  `translation_model` varchar(100) DEFAULT NULL COMMENT '번역에 사용된 모델',
  `extraction_time_seconds` decimal(10,3) DEFAULT NULL COMMENT '텍스트 추출 소요 시간(초)',
  `summary_time_seconds` decimal(10,3) DEFAULT NULL COMMENT '요약 생성 소요 시간(초)',
  `translation_time_seconds` decimal(10,3) DEFAULT NULL COMMENT '번역 소요 시간(초)',
  `file_size_bytes` bigint(20) DEFAULT NULL COMMENT 'PDF 파일 크기(바이트)',
  `total_pages` int(11) DEFAULT NULL COMMENT 'PDF 전체 페이지 수',
  `successful_pages` int(11) DEFAULT NULL COMMENT '성공적으로 추출된 페이지 수',
  `category` enum('강의','법률안','보고서','기타') NOT NULL DEFAULT '기타' COMMENT '문서 카테고리',
  `is_important` tinyint(1) DEFAULT 0 COMMENT '중요문서 여부',
  `password` varchar(4) DEFAULT NULL COMMENT '4자리 숫자 비밀번호 (중요문서만 해당)',
  `is_public` tinyint(1) DEFAULT 1 COMMENT '공개 여부 (True: 공개, False: 비공개)',
  PRIMARY KEY (`id`),
  KEY `ix_pdf_documents_category` (`category`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `pdf_documents`
--

LOCK TABLES `pdf_documents` WRITE;
/*!40000 ALTER TABLE `pdf_documents` DISABLE KEYS */;
/*!40000 ALTER TABLE `pdf_documents` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_sessions`
--

DROP TABLE IF EXISTS `user_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_sessions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `session_token` varchar(255) NOT NULL,
  `created_at` datetime DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ix_user_sessions_session_token` (`session_token`),
  KEY `user_id` (`user_id`),
  KEY `ix_user_sessions_id` (`id`),
  KEY `ix_user_sessions_expires_at` (`expires_at`),
  KEY `ix_user_sessions_is_active` (`is_active`),
  CONSTRAINT `user_sessions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_sessions`
--

LOCK TABLES `user_sessions` WRITE;
/*!40000 ALTER TABLE `user_sessions` DISABLE KEYS */;
INSERT INTO `user_sessions` VALUES
(1,4,'fadfc400-fe89-477a-b4c1-754f541d36ab','2026-03-06 03:12:19','2026-04-05 03:12:19',1,'172.18.0.1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'),
(2,5,'7443bdfc-111d-40b1-971e-31ca60df1c24','2026-03-06 03:12:25','2026-04-05 03:12:25',1,'172.18.0.1','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36');
/*!40000 ALTER TABLE `user_sessions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `full_name` varchar(100) DEFAULT NULL,
  `role` enum('admin','user') DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  `last_login_at` datetime DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ix_users_email` (`email`),
  UNIQUE KEY `ix_users_username` (`username`),
  KEY `ix_users_is_active` (`is_active`),
  KEY `ix_users_role` (`role`),
  KEY `ix_users_id` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES
(4,'jayyoonlee','jayyoon.lee98@gmail.com','$2b$12$b3AdoukjlGmpCD1xsP0tiOvGpbwtt0QPWqvUbuVKpIRgyuHTzxxbm','이재윤','user','2026-03-06 03:12:14','2026-03-06 03:12:14',NULL,1),
(5,'osj2020','osj4040@naver.com','$2b$12$SN4r7VXE3tgmVhYlizhiE.5BP4kIuNrj5qWCvl0ociAMe9wSZ31c.','오상진','user','2026-03-06 03:12:18','2026-03-06 03:12:18',NULL,1);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping events for database 'pdf_summary'
--

--
-- Dumping routines for database 'pdf_summary'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;

-- Dump completed on 2026-03-06  3:22:33
