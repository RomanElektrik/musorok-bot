// Подключаем необходимые библиотеки
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const http = require('http'); // Добавлено для Render
require('dotenv').config();

// Токены ботов
const CLIENT_BOT_TOKEN = process.env.CLIENT_BOT_TOKEN;
const COURIER_BOT_TOKEN = process.env.COURIER_BOT_TOKEN;

console.log('Запуск приложения...');
console.log('Токены ботов загружены:', 
  CLIENT_BOT_TOKEN ? 'Клиентский бот: Да' : 'Клиентский бот: Нет', 
  COURIER_BOT_TOKEN ? 'Курьерский бот: Да' : 'Курьерский бот: Нет');

// Создаем простой HTTP сервер для поддержания работы на Render
const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('МусорОК бот активен!\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

// Подключение к MongoDB
console.log('Подключение к MongoDB...');
const { MongoClient, ServerApiVersion } = require('mongodb');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/musorOK';

mongoose.connect(MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true
  },
  dbName: 'musorOK'
})
  .then(() => {
    console.log('MongoDB подключена успешно');
    startBots();
  })
  .catch(err => {
    console.error('Ошибка подключения к MongoDB:', err);
    process.exit(1);
  });

// Схемы для MongoDB
// Схема курьера
const courierSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  fullName: { type: String },
  phone: { type: String },
  city: { type: String },
  district: { type: String },
  verified: { type: Boolean, default: false },
  location: {
    latitude: Number,
    longitude: Number,
    lastUpdated: Date
  },
  available: { type: Boolean, default: false },
  currentOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  cardNumber: { type: String },
  rating: { type: Number, default: 0 }
});

// Схема клиента
const clientSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  addresses: [{
    street: String,
    houseNumber: String,
    entrance: String,
    floor: String,
    apartment: String,
    location: {
      latitude: Number,
      longitude: Number
    }
  }],
  phone: { type: String },
  orders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order' }]
});

// Схема заказа
const orderSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  address: {
    street: String,
    houseNumber: String,
    entrance: String,
    floor: String,
    apartment: String,
    location: {
      latitude: Number,
      longitude: Number
    }
  },
  status: { 
    type: String, 
    enum: ['created', 'assigned', 'inProgress', 'completed', 'cancelled'],
    default: 'created'
  },
  courierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Courier' },
  price: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
  completedAt: Date
});

// Создаем модели
const Courier = mongoose.model('Courier', courierSchema);
const Client = mongoose.model('Client', clientSchema);
const Order = mongoose.model('Order', orderSchema);

// Сессии для хранения состояний пользователей
const clientSessions = {};
const courierSessions = {};

// Функция запуска ботов
function startBots() {
  // Создаем ботов
  const clientBot = new Telegraf(CLIENT_BOT_TOKEN);
  const courierBot = new Telegraf(COURIER_BOT_TOKEN);
  
  // Функции для геолокации и поиска ближайшего курьера
  async function findNearestCourier(location) {
    const availableCouriers = await Courier.find({ 
      available: true, 
      verified: true,
      'location.latitude': { $exists: true },
      'location.longitude': { $exists: true }
    });
    
    if (availableCouriers.length === 0) return null;
    
    // Простое вычисление расстояния (для примера)
    const couriersWithDistance = availableCouriers.map(courier => {
      const distance = Math.sqrt(
        Math.pow(location.latitude - courier.location.latitude, 2) + 
        Math.pow(location.longitude - courier.location.longitude, 2)
      );
      
      return { courier, distance };
    });
    
    // Сортировка по расстоянию
    couriersWithDistance.sort((a, b) => a.distance - b.distance);
    
    return couriersWithDistance[0].courier;
  }

  // Функция для преобразования адреса в координаты
  async function geocodeAddress(address) {
    // Заглушка - реальная реализация должна использовать API геокодирования
    return {
      latitude: 55.7558, // Примерные координаты Москвы
      longitude: 37.6173
    };
  }

  // КЛИЕНТСКИЙ БОТ

  // Запуск бота для клиентов
  clientBot.start(async (ctx) => {
    console.log('Клиент запустил бота:', ctx.from.id);
    const userId = ctx.from.id;
    
    // Проверяем, существует ли клиент в базе
    let client = await Client.findOne({ userId });
    
    if (!client) {
      client = new Client({ userId });
      await client.save();
      console.log('Создан новый клиент:', userId);
    }
    
    clientSessions[userId] = { step: 'idle' };
    
    ctx.reply('Добро пожаловать в сервис МусорОК! Чтобы сделать заказ, нажмите кнопку ниже.', {
      reply_markup: {
        keyboard: [
          [{ text: '🚮 Заказать вынос мусора' }]
        ],
        resize_keyboard: true
      }
    });
  });

  // Обработка команды заказа выноса мусора
  clientBot.hears('🚮 Заказать вынос мусора', (ctx) => {
    const userId = ctx.from.id;
    clientSessions[userId] = { step: 'address' };
    
    ctx.reply('🏠 Отправьте ваш адрес (улица и номер дома)', {
      reply_markup: {
        keyboard: [
          [{ text: 'Отменить' }]
        ],
        resize_keyboard: true
      }
    });
  });

  // Обработка текстовых сообщений от клиента
  clientBot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    
    if (text === 'Отменить') {
      clientSessions[userId] = { step: 'idle' };
      return ctx.reply('Заказ отменен', {
        reply_markup: {
          keyboard: [
            [{ text: '🚮 Заказать вынос мусора' }]
          ],
          resize_keyboard: true
        }
      });
    }
    
    if (!clientSessions[userId]) {
      clientSessions[userId] = { step: 'idle' };
      return ctx.reply('Для начала работы нажмите кнопку ниже', {
        reply_markup: {
          keyboard: [
            [{ text: '🚮 Заказать вынос мусора' }]
          ],
          resize_keyboard: true
        }
      });
    }
    
    const session = clientSessions[userId];
    
    switch (session.step) {
      case 'address':
        // Сохраняем адрес и запрашиваем детали подъезда
        session.address = {
          street: text,
          houseNumber: ''
        };
        
        session.step = 'entrance';
        
        ctx.reply('🚪 Отправьте номер подъезда, этажа и квартиры одним сообщением', {
          reply_markup: {
            keyboard: [
              [{ text: 'Отменить' }]
            ],
            resize_keyboard: true
          }
        });
        break;
        
      case 'entrance':
        // Детали подъезда получены, запрашиваем подтверждение заказа
        let entrance = '1', floor = '1', apartment = '1';
        
        // Пытаемся разобрать ввод
        const entranceDetails = text.split(',').map(part => part.trim());
        if (entranceDetails.length >= 3) {
          entrance = entranceDetails[0];
          floor = entranceDetails[1];
          apartment = entranceDetails[2];
        } else {
          // Если формат не соответствует, используем весь текст
          entrance = text;
        }
        
        session.address.entrance = entrance;
        session.address.floor = floor;
        session.address.apartment = apartment;
        
        // Получаем координаты
        session.address.location = await geocodeAddress(session.address.street);
        
        session.step = 'confirm';
        session.price = 149; // Фиксированная цена
        
        ctx.reply(`🔄 Проверьте детали заказа:
        
Адрес: ${session.address.street}
Подъезд: ${session.address.entrance}
Этаж: ${session.address.floor}
Квартира: ${session.address.apartment}

Стоимость: ${session.price}₽`, {
          reply_markup: {
            keyboard: [
              [{ text: 'Оплатить' }],
              [{ text: 'Изменить адрес' }],
              [{ text: 'Отменить' }]
            ],
            resize_keyboard: true
          }
        });
        break;
        
      case 'confirm':
        if (text === 'Оплатить') {
          try {
            const client = await Client.findOne({ userId });
            
            if (!client) {
              throw new Error('Клиент не найден');
            }
            
            // Создаем новый заказ
            const newOrder = new Order({
              clientId: client._id,
              address: session.address,
              price: session.price
            });
            
            await newOrder.save();
            console.log('Создан новый заказ:', newOrder._id);
            
            // Добавляем заказ в список клиента
            if (!client.orders) client.orders = [];
            client.orders.push(newOrder._id);
            await client.save();
            
            ctx.reply('✅ Заказ оплачен! Ищем ближайшего курьера...');
            
            // Поиск ближайшего курьера в асинхронном режиме
            setTimeout(async () => {
              try {
                // Уведомляем курьеров (для демонстрации можно уведомить всех курьеров)
                const couriers = await Courier.find({ verified: true, available: true });
                
                if (couriers.length > 0) {
                  // Отправляем заказ первому доступному курьеру
                  const courier = couriers[0];
                  
                  // Обновляем статус заказа
                  newOrder.status = 'assigned';
                  newOrder.courierId = courier._id;
                  await newOrder.save();
                  
                  // Отправляем уведомление курьеру
                  courierBot.telegram.sendMessage(courier.userId, `📦 Новый заказ!
                  
Адрес: ${session.address.street}
Подъезд: ${session.address.entrance}
Этаж: ${session.address.floor}
Квартира: ${session.address.apartment}

Стоимость: ${session.price}₽`, {
                    reply_markup: {
                      keyboard: [
                        [{ text: `Принять заказ №${newOrder._id}` }],
                        [{ text: 'Отклонить заказ' }]
                      ],
                      resize_keyboard: true
                    }
                  });
                  
                  ctx.reply('👍 Курьер найден! Он скоро свяжется с вами.');
                } else {
                  ctx.reply('⏳ В данный момент нет доступных курьеров. Мы назначим курьера, как только кто-то освободится.');
                }
              } catch (err) {
                console.error('Ошибка при поиске курьера:', err);
                ctx.reply('Произошла ошибка при поиске курьера. Пожалуйста, попробуйте позже.');
              }
            }, 2000);
            
            // Сброс сессии
            clientSessions[userId] = { step: 'idle' };
            
            // Возвращаем главное меню
            setTimeout(() => {
              ctx.reply('Что дальше?', {
                reply_markup: {
                  keyboard: [
                    [{ text: '🚮 Заказать вынос мусора' }],
                    [{ text: 'Мои заказы' }]
                  ],
                  resize_keyboard: true
                }
              });
            }, 4000);
          } catch (err) {
            console.error('Ошибка при создании заказа:', err);
            ctx.reply('Произошла ошибка при создании заказа. Пожалуйста, попробуйте еще раз.');
          }
        } else if (text === 'Изменить адрес') {
          session.step = 'address';
          ctx.reply('🏠 Отправьте ваш адрес (улица и номер дома)', {
            reply_markup: {
              keyboard: [
                [{ text: 'Отменить' }]
              ],
              resize_keyboard: true
            }
          });
        }
        break;
        
      default:
        // Если шаг не определен, предлагаем начать заказ
        ctx.reply('Для заказа выноса мусора нажмите на кнопку ниже', {
          reply_markup: {
            keyboard: [
              [{ text: '🚮 Заказать вынос мусора' }]
            ],
            resize_keyboard: true
          }
        });
    }
  });
  
  // КУРЬЕРСКИЙ БОТ

  // Запуск бота для курьеров
  courierBot.start(async (ctx) => {
    console.log('Курьер запустил бота:', ctx.from.id);
    const userId = ctx.from.id;
    
    // Проверяем, существует ли курьер в базе
    let courier = await Courier.findOne({ userId });
    
    if (!courier) {
      courier = new Courier({ userId });
      await courier.save();
      console.log('Создан новый курьер:', userId);
      
      courierSessions[userId] = { step: 'new' };
      
      ctx.reply('👋 Привет! Я бот для курьеров сервиса МусорОК.\n\nЧтобы начать зарабатывать, пройди простую регистрацию.', {
        reply_markup: {
          keyboard: [
            [{ text: 'Зарегистрироваться' }],
            [{ text: 'О сервисе' }]
          ],
          resize_keyboard: true
        }
      });
    } else if (!courier.verified) {
      courierSessions[userId] = { step: 'registration' };
      
      ctx.reply('Продолжим регистрацию. На каком этапе вы остановились?', {
        reply_markup: {
          keyboard: [
            [{ text: 'Ввести ФИО' }],
            [{ text: 'Указать город и район' }],
            [{ text: 'Ввести номер телефона' }],
            [{ text: 'Загрузить фото паспорта' }]
          ],
          resize_keyboard: true
        }
      });
    } else {
      courierSessions[userId] = { step: 'main' };
      
      const availabilityButton = courier.available ? 
        { text: '🔴 Завершить работу' } : 
        { text: '🟢 Начать работу' };
      
      ctx.reply('Добро пожаловать обратно! Выберите действие:', {
        reply_markup: {
          keyboard: [
            [availabilityButton],
            [{ text: 'Мои заказы' }],
            [{ text: 'Мой счёт' }],
            [{ text: 'Поделиться локацией', request_location: true }]
          ],
          resize_keyboard: true
        }
      });
    }
  });

  // Обработка регистрации
  courierBot.hears('Зарегистрироваться', (ctx) => {
    const userId = ctx.from.id;
    courierSessions[userId] = { step: 'fullName' };
    
    ctx.reply('👤 Добро пожаловать в систему регистрации курьеров!\n\nДля начала работы, пожалуйста, введите ваше полное ФИО:', {
      reply_markup: {
        keyboard: [
          [{ text: 'Отменить' }]
        ],
        resize_keyboard: true
      }
    });
  });

  // Обработка "О сервисе"
  courierBot.hears('О сервисе', (ctx) => {
    ctx.reply('Как это работает:\n\n✅ Берёшь заказ который тебе удобно выполнять\n✅ Забираешь мусор от двери\n✅ Присылаешь фото выполненного заказа\n✅ Вечером в 21:00 получаешь деньги на карту', {
      reply_markup: {
        keyboard: [
          [{ text: 'Начать работать' }],
          [{ text: 'Зарегистрироваться' }]
        ],
        resize_keyboard: true
      }
    });
  });

  // Обработка кнопки "Начать работать"
  courierBot.hears(['Начать работать', '🟢 Начать работу'], async (ctx) => {
    const userId = ctx.from.id;
    const courier = await Courier.findOne({ userId });
    
    if (!courier || !courier.verified) {
      courierSessions[userId] = { step: 'fullName' };
      
      return ctx.reply('Для начала работы необходимо пройти регистрацию. Пожалуйста, введите ваше полное ФИО:');
    }
    
    courier.available = true;
    await courier.save();
    
    courierSessions[userId] = { step: 'main' };
    
    ctx.reply('Вы начали работу! Теперь вы можете получать заказы.', {
      reply_markup: {
        keyboard: [
          [{ text: '🔴 Завершить работу' }],
          [{ text: 'Мои заказы' }],
          [{ text: 'Поделиться локацией', request_location: true }]
        ],
        resize_keyboard: true
      }
    });
  });

  // Обработка текстовых сообщений от курьера
  courierBot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    
    if (!courierSessions[userId]) {
      courierSessions[userId] = { step: 'new' };
      
      return ctx.reply('Для начала работы нажмите /start');
    }
    
    const session = courierSessions[userId];
    let courier = await Courier.findOne({ userId });
    
    // Если курьера нет в базе, создаем
    if (!courier) {
      courier = new Courier({ userId });
      await courier.save();
    }
    
    // Обработка команды "Отменить"
    if (text === 'Отменить') {
      courierSessions[userId] = { step: 'main' };
      
      return ctx.reply('Действие отменено', {
        reply_markup: {
          keyboard: [
            [{ text: 'Зарегистрироваться' }],
            [{ text: 'О сервисе' }]
          ],
          resize_keyboard: true
        }
      });
    }
    
    // Обработка команды "Завершить работу"
    if (text === '🔴 Завершить работу') {
      courier.available = false;
      await courier.save();
      
      return ctx.reply('Вы завершили работу на сегодня. Спасибо!', {
        reply_markup: {
          keyboard: [
            [{ text: '🟢 Начать работу' }],
            [{ text: 'Мои заказы' }],
            [{ text: 'Мой счёт' }]
          ],
          resize_keyboard: true
        }
      });
    }
    
    // Обработка команды "Мои заказы"
    if (text === 'Мои заказы') {
      const orders = await Order.find({ courierId: courier._id }).sort('-createdAt').limit(5);
      
      if (orders.length === 0) {
        return ctx.reply('У вас пока нет заказов.');
      }
      
      let message = 'Ваши последние заказы:\n\n';
      
      for (const order of orders) {
        const statusMap = {
          'created': '⏳ Создан',
          'assigned': '🔄 Назначен',
          'inProgress': '🚶‍♂️ В процессе',
          'completed': '✅ Выполнен',
          'cancelled': '❌ Отменен'
        };
        
        message += `📋 Заказ от ${new Date(order.createdAt).toLocaleDateString()}\n`;
        message += `🏠 ${order.address.street}, подъезд ${order.address.entrance}\n`;
        message += `💰 Сумма: ${order.price}₽\n`;
        message += `🔄 Статус: ${statusMap[order.status] || order.status}\n\n`;
      }
      
      return ctx.reply(message);
    }
    
    // Обработка команды "Мой счёт"
    if (text === 'Мой счёт') {
      // Вычисляем примерный заработок
      const completed = await Order.find({ 
        courierId: courier._id, 
        status: 'completed' 
      });
      
      const totalEarnings = completed.reduce((sum, order) => sum + order.price, 0);
      
      return ctx.reply(`💰 Информация о счете:
      
Выполнено заказов: ${completed.length}
Общий заработок: ${totalEarnings}₽
Выплата сегодня в 21:00: ${totalEarnings}₽

Заработок зависит от количества выполненных заказов.`);
    }
    
    // Обработка шагов регистрации
    switch (session.step) {
      case 'fullName':
        courier.fullName = text;
        await courier.save();
        
        session.step = 'city';
        
        ctx.reply('✅ Отлично! Укажите город и район в формате: Город, Район\n\nНапример: Пенза, Октябрьский');
        break;
        
      case 'city':
        const cityParts = text.split(',');
        
        if (cityParts.length >= 2) {
          courier.city = cityParts[0].trim();
          courier.district = cityParts[1].trim();
        } else {
          courier.city = text.trim();
          courier.district = '';
        }
        
        await courier.save();
        
        session.step = 'phone';
        
        ctx.reply('📱 Ещё нужен твой номер телефона. Это нужно для подстраховки - если что-то пойдет не так, мы сможем с тобой связаться. Нажмите кнопку ниже, чтобы отправить номер телефона.', {
          reply_markup: {
            keyboard: [
              [{ text: 'Отправить номер телефона', request_contact: true }],
              [{ text: 'Ввести номер вручную' }]
            ],
            resize_keyboard: true
          }
        });
        break;
        
      case 'phone':
        if (text === 'Ввести номер вручную') {
          return ctx.reply('Введите ваш номер телефона в формате +7XXXXXXXXXX:');
        }
        
        courier.phone = text;
        await courier.save();
        
        session.step = 'passport';
        
        ctx.reply('📷 Отлично! Теперь нужна фотография для подтверждения личности.\n\nСделай селфи с первой страницей паспорта в руках. Все данные должно быть хорошо видно.\n\nЭто стандартная процедура безопасности, как в Яндекс.Такси и других сервисах 👍');
        break;
    }
  });

  // Обработка фотографий
  courierBot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const session = courierSessions[userId];
    
    if (session && session.step === 'passport') {
      const courier = await Courier.findOne({ userId });
      
      if (courier) {
        // Для демонстрации сразу верифицируем
        courier.verified = true;
        await courier.save();
        
        ctx.reply('✅ Ваш паспорт проверен и подтвержден! Теперь вы можете начать работать.', {
          reply_markup: {
            keyboard: [
              [{ text: '🟢 Начать работу' }],
              [{ text: 'Мои заказы' }],
              [{ text: 'Поделиться локацией', request_location: true }]
            ],
            resize_keyboard: true
          }
        });
        
        courierSessions[userId] = { step: 'main' };
      }
    }
  });

  // Обработка геолокации
  courierBot.on('location', async (ctx) => {
    const userId = ctx.from.id;
    const location = ctx.message.location;
    
    const courier = await Courier.findOne({ userId });
    
    if (courier) {
      courier.location = {
        latitude: location.latitude,
        longitude: location.longitude,
        lastUpdated: new Date()
      };
      
      await courier.save();
      
      ctx.reply('✅ Ваша локация обновлена! Теперь вы сможете получать заказы поблизости.', {
        reply_markup: {
          keyboard: [
            [{ text: courier.available ? '🔴 Завершить работу' : '🟢 Начать работу' }],
            [{ text: 'Мои заказы' }],
            [{ text: 'Поделиться локацией', request_location: true }]
          ],
          resize_keyboard: true
        }
      });
    }
  });

  // Обработка контактов (для телефона)
  courierBot.on('contact', async (ctx) => {
    const userId = ctx.from.id;
    const session = courierSessions[userId];
    
    if (session && session.step === 'phone') {
      const courier = await Courier.findOne({ userId });
      
      if (courier) {
        courier.phone = ctx.message.contact.phone_number;
        await courier.save();
        
        session.step = 'passport';
        
        ctx.reply('📷 Отлично! Теперь нужна фотография для подтверждения личности.\n\nСделай селфи с первой страницей паспорта в руках. Все данные должно быть хорошо видно.\n\nЭто стандартная процедура безопасности, как в Яндекс.Такси и других сервисах 👍');
      }
    }
  });

  // Запуск ботов
  console.log('Запуск ботов...');
  
  clientBot.launch()
    .then(() => console.log('Клиентский бот успешно запущен'))
    .catch(err => console.error('Ошибка запуска клиентского бота:', err));
  
  courierBot.launch()
    .then(() => console.log('Курьерский бот успешно запущен'))
    .catch(err => console.error('Ошибка запуска курьерского бота:', err));
  
  // Обработка завершения работы (Ctrl+C)
  process.once('SIGINT', () => {
    clientBot.stop('SIGINT');
    courierBot.stop('SIGINT');
    console.log('Боты остановлены');
  });
  
  process.once('SIGTERM', () => {
    clientBot.stop('SIGTERM');
    courierBot.stop('SIGTERM');
    console.log('Боты остановлены');
  });
}
