// Sinh từ docs/examples/reel-story-sample.spec.json
window.DRAMA_SAMPLE = {
  "title": "Tình Muộn (spec mẫu do đạo diễn viết)",
  "audio": "narration",
  "style": "Màu phim điện ảnh ấm trầm 35mm, ánh sáng tự nhiên mềm trong quán cà phê, nền thành phố nhìn qua cửa kính.",
  "characters": [
    {
      "id": "nu",
      "name": "Nữ chính",
      "look": "nữ 26 tuổi, gương mặt thanh tú, tóc đen dài buông ngang vai, áo len cổ cao màu kem, quần tây đen, không đeo phụ kiện",
      "height_cm": 163
    },
    {
      "id": "nam",
      "name": "Nam chính",
      "look": "nam 33 tuổi, cao ráo, gương mặt góc cạnh, tóc đen ngắn gọn gàng, vest xám than, sơ mi trắng, không cà vạt",
      "height_cm": 182
    }
  ],
  "shots": [
    {
      "id": 1,
      "seconds": 6,
      "purpose": "Người xem hiểu người đàn ông vừa nhìn thấy đúng người mà anh đã tìm rất lâu.",
      "hook": "Anh khựng lại ngay ở cửa quán ở giây đầu tiên, như vừa bị chặn bởi thứ gì đó ngoài khung.",
      "state_change": "info",
      "setting": "quán cà phê trong thành phố, ánh sáng tự nhiên qua cửa kính",
      "cast": [
        "nam"
      ],
      "director": {
        "wants": {
          "nam": "xác nhận người ngồi bên trong có đúng là cô không"
        },
        "winner": "none",
        "frame_favors": "none"
      },
      "camera": {
        "size": "close",
        "move": "push-in"
      },
      "beats": [
        {
          "from": 0,
          "to": 3,
          "action": "Nam chính đẩy cửa bước vào, bước chân khựng lại, ánh mắt dừng cố định ở một điểm bên phải ngoài khung.",
          "emotion": {
            "nam": {
              "label": "mắt mở to, môi hé nhẹ",
              "level": 2,
              "because": "anh thấy một gương mặt quen mà không ngờ gặp ở đây"
            }
          }
        },
        {
          "from": 3,
          "to": 6,
          "action": "Bàn tay anh trên tay nắm cửa siết lại, vai nâng lên rồi giữ yên.",
          "emotion": {
            "nam": {
              "label": "hàm siết lại, mắt long lanh",
              "level": 3,
              "because": "anh nhận ra đúng là người anh đã tìm"
            }
          }
        }
      ],
      "final_frame": "Cận mặt Nam chính đứng yên ở cửa, ánh mắt vẫn hướng sang bên phải khung.",
      "narration": "Họ từng yêu nhau say đắm, rồi sự bồng bột và những hiểu lầm đẩy hai người về hai phương trời."
    },
    {
      "id": 2,
      "seconds": 8,
      "purpose": "Người xem hiểu cô đã khép lòng với đời, và cô vừa phát hiện ra anh.",
      "state_change": "info",
      "setting": "quán cà phê trong thành phố, ánh sáng tự nhiên qua cửa kính",
      "cast": [
        "nu"
      ],
      "director": {
        "wants": {
          "nu": "ngồi yên cho hết buổi chiều, không muốn ai đến gần"
        },
        "winner": "none",
        "frame_favors": "none"
      },
      "camera": {
        "size": "medium",
        "move": "static"
      },
      "beats": [
        {
          "from": 0,
          "to": 4,
          "action": "Nữ chính ngồi cạnh cửa sổ, hai tay ôm tách cà phê, khuấy chậm một vòng, mắt nhìn xuống mặt bàn.",
          "emotion": {
            "nu": {
              "label": "vai thả lỏng, môi khép thành một đường thẳng, mắt nhìn xuống",
              "level": 1,
              "because": "cô đã quen với sự yên lặng một mình"
            }
          }
        },
        {
          "from": 4,
          "to": 8,
          "action": "Cô ngẩng lên, nhìn sang bên trái khung, mi mắt chớp một lần rồi giữ nguyên ánh nhìn.",
          "emotion": {
            "nu": {
              "label": "mắt mở rộng hơn, hơi thở dừng lại",
              "level": 2,
              "because": "cô nhận ra người vừa bước vào"
            }
          }
        }
      ],
      "final_frame": "Trung cảnh Nữ chính nhìn sang bên trái khung, hai tay vẫn ôm tách cà phê.",
      "narration": "Mười năm sau, giữa phố thị phồn hoa, anh đã thành người quyền lực, còn cô mệt mỏi với đời và khép chặt trái tim."
    },
    {
      "id": 3,
      "seconds": 8,
      "purpose": "Người xem hiểu anh là người phải tiến lại gần, còn cô là người giữ quyền quyết định.",
      "state_change": "power",
      "setting": "quán cà phê trong thành phố, ánh sáng tự nhiên qua cửa kính",
      "cast": [
        "nam",
        "nu"
      ],
      "layout": {
        "nam": {
          "side": "left",
          "facing": "right",
          "gaze": "nu",
          "why": "anh đi tìm cô và cuối cùng thấy cô"
        },
        "nu": {
          "side": "right",
          "facing": "left",
          "gaze": "nam",
          "why": "cô nhìn thẳng để không để lộ mình dao động"
        }
      },
      "director": {
        "wants": {
          "nam": "được cô nhìn lại",
          "nu": "giữ khoảng cách"
        },
        "winner": "nu",
        "frame_favors": "nu",
        "frame_note": "Nữ chính ngồi ở vị trí gần tâm khung, ánh sáng cửa sổ rơi lên mặt cô; Nam chính đứng lệch về mép trái khung, bóng người hơi nghiêng về phía cô"
      },
      "camera": {
        "size": "wide",
        "move": "static"
      },
      "beats": [
        {
          "from": 0,
          "to": 4,
          "action": "Nam chính đi chậm lại gần bàn, dừng cách bàn một sải tay, hai người nhìn nhau.",
          "emotion": {
            "nam": {
              "label": "hai tay buông thõng, ngực phập phồng",
              "level": 3,
              "because": "anh sợ chỉ một bước nữa cô sẽ biến mất"
            },
            "nu": {
              "label": "lưng thẳng, ánh mắt giữ yên",
              "level": 2,
              "because": "cô muốn giữ vẻ bình tĩnh"
            }
          }
        },
        {
          "from": 4,
          "to": 8,
          "action": "Nữ chính đặt thìa xuống đĩa, không đứng dậy, ngẩng mặt nhìn thẳng vào anh.",
          "emotion": {
            "nam": {
              "label": "mắt long lanh, môi mím chặt",
              "level": 3,
              "because": "anh chờ cô lên tiếng"
            },
            "nu": {
              "label": "cằm hơi nâng, mắt không rời anh",
              "level": 3,
              "because": "cô đang quyết định có cho anh lại gần hay không"
            }
          }
        }
      ],
      "final_frame": "Toàn cảnh hai người đối diện nhau, Nam chính đứng, Nữ chính ngồi nhìn thẳng vào anh.",
      "narration": "Sau cả một thập kỷ tìm kiếm, anh nghẹn ngào bước tới."
    },
    {
      "id": 4,
      "seconds": 6,
      "purpose": "Người xem hiểu cô không rút tay lại, và câu hỏi cô sẽ làm gì tiếp theo vẫn còn treo.",
      "state_change": "relation",
      "setting": "quán cà phê trong thành phố, ánh sáng tự nhiên qua cửa kính",
      "cast": [
        "nam",
        "nu"
      ],
      "layout": {
        "nam": {
          "side": "left",
          "facing": "right",
          "gaze": "nu",
          "why": "anh nhìn bàn tay cô rồi nhìn lên mặt cô"
        },
        "nu": {
          "side": "right",
          "facing": "left",
          "gaze": "nam",
          "why": "cô nhìn anh để biết anh có thật lòng không"
        }
      },
      "director": {
        "wants": {
          "nam": "được giữ cô lại",
          "nu": "biết anh có thật lòng"
        },
        "winner": "none",
        "frame_favors": "none"
      },
      "camera": {
        "size": "close",
        "move": "pull-back"
      },
      "beats": [
        {
          "from": 0,
          "to": 3,
          "action": "Bàn tay Nam chính khép lên bàn tay Nữ chính đang đặt cạnh tách cà phê.",
          "emotion": {
            "nam": {
              "label": "mắt long lanh, hơi thở chậm lại",
              "level": 3,
              "because": "anh chạm vào cô sau bao năm"
            },
            "nu": {
              "label": "mắt nhìn xuống bàn tay anh, môi khép lại",
              "level": 3,
              "because": "cô bất ngờ vì hơi ấm quen thuộc"
            }
          }
        },
        {
          "from": 3,
          "to": 6,
          "action": "Nữ chính giữ nguyên tay, ngẩng lên nhìn anh, môi run nhẹ.",
          "emotion": {
            "nam": {
              "label": "đầu cúi nhẹ về phía cô, mắt không rời",
              "level": 3,
              "because": "anh chờ câu trả lời của cô"
            },
            "nu": {
              "label": "mắt đỏ lên, môi run nhẹ",
              "level": 3,
              "because": "cô đang chống lại việc mở lòng"
            }
          }
        }
      ],
      "final_frame": "Hai bàn tay vẫn đan vào nhau trên mặt bàn gỗ, tách cà phê bốc hơi mờ phía sau.",
      "narration": "Nếu thời gian có thể quay lại, anh nhất định sẽ không bao giờ buông tay em."
    }
  ]
};
